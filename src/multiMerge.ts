import vscode from "vscode";
import { getCurrentCommitId, getWorkspacePath } from "./utils";
import { t } from "./i18n";
import {
  createWorktree,
  switchToTargetBranch,
  pullLatestCode,
  mergeBranch,
  pushToRemote,
  cleanupWorktree,
  checkAndPromptStaleWorktrees,
  checkAndHandleUnpushedCommits,
  createWorktreeConfig,
} from "./singleMerge";

// 单分支合并配置
export interface BranchMergeConfig {
  from: string;
  to: string;
}

/**
 * 合并操作接口
 */
interface MergeOperation {
  from: string;
  to: string;
  displayName: string;
}

export interface MergePreset {
  name: string;
  branches: BranchMergeConfig[];
}

export interface MultipleMergeResult {
  targetBranch: string;
  success: boolean;
  error?: string;
  hasNewCommits?: boolean;
}

/**
 * 执行单个分支的合并流程（用于多分支合并）
 */
async function executeSingleMergeFlow(targetBranch: string, sourceBranch: string, workspacePath: string): Promise<MultipleMergeResult> {
  const config = createWorktreeConfig(workspacePath, targetBranch, sourceBranch);

  try {
    // 只在第一次合并时检查历史残留的 worktrees
    // await checkAndPromptStaleWorktrees();

    await createWorktree(config.repoPath, config.worktreePath, targetBranch);
    await switchToTargetBranch(config.worktreePath, targetBranch);
    await pullLatestCode(config.worktreePath, targetBranch);

    // 获取合并前的 commit id
    const beforeMergeCommitId = getCurrentCommitId(config.worktreePath);

    await mergeBranch(config.worktreePath, sourceBranch, targetBranch);

    // 获取合并后的 commit id
    const afterMergeCommitId = getCurrentCommitId(config.worktreePath);

    // 检查是否有新的提交
    const hasNewCommits = beforeMergeCommitId !== afterMergeCommitId;

    await pushToRemote(config.worktreePath, targetBranch);
    await cleanupWorktree(config);

    return {
      targetBranch,
      success: true,
      hasNewCommits
    };

  } catch (error) {
    await cleanupWorktree(config);
    return {
      targetBranch,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 显示多分支合并结果
 */
function showMultipleMergeResults(
  results: MultipleMergeResult[],
  totalOperations: number,
  sourceBranch: string,
  preset?: MergePreset,
  targetBranches?: string[],
  allOperations?: MergeOperation[]
): void {
  const successResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  const wasAborted = results.length < totalOperations;

  if (failedResults.length === 0) {
    // 全部成功
    const successBranches = successResults.map(r => r.targetBranch).join(', ');
    if (preset) {
      vscode.window.showInformationMessage(
        t('success.presetMergeComplete', preset.name, sourceBranch, successBranches)
      );
    } else {
      vscode.window.showInformationMessage(
        t('success.multipleMergeComplete', sourceBranch, successBranches)
      );
    }
  } else if (successResults.length === 0 && !wasAborted) {
    // 全部失败（第一个就失败了）
    const failedBranches = failedResults.map(r => `${r.targetBranch}: ${r.error}`).join('\n');
    const branches = preset ? preset.branches.map(b => b.to).join(', ') : (targetBranches || []).join(', ');
    vscode.window.showErrorMessage(
      t('error.mergeFailedGeneral', sourceBranch, branches, failedBranches)
    );
  } else {
    // 部分成功或出错中断
    const successBranches = successResults.map(r => r.targetBranch).join(', ');
    const failedBranch = failedResults.length > 0 ? failedResults[0] : null;
    
    let message: string;
    
    if (wasAborted && failedBranch) {
      // 出错中断的情况
      const skippedCount = totalOperations - results.length;
      const completedCount = successResults.length;
      
      // 简洁的主要消息
      const mainMessage = t('error.mergeAbortedShort', 
        failedBranch.targetBranch,
        completedCount.toString(),
        totalOperations.toString(),
        skippedCount.toString()
      );
      
      // 详细信息
      let detailsMessage = `❌ ${t('error.mergeAbortedTitle')}\n\n`;
      detailsMessage += `${t('error.failedAt')}: ${failedBranch.targetBranch}\n`;
      detailsMessage += `${t('error.errorMessage')}: ${failedBranch.error || t('error.unknown')}\n\n`;
      detailsMessage += `${t('progress.completed')}: ${completedCount}/${totalOperations}\n`;
      detailsMessage += `${t('progress.canceled')}: ${skippedCount}\n`;
      
      // 获取被取消的操作列表
      if (allOperations && allOperations.length > results.length) {
        const canceledOperations = allOperations.slice(results.length);
        const canceledList = canceledOperations.map(op => `  • ${op.displayName}`).join('\n');
        detailsMessage += `\n${t('error.canceledOperationsList')}:\n${canceledList}\n`;
      }
      
      if (completedCount > 0) {
        detailsMessage += `\n${t('success.completedBranchesList')}:\n  • ${successBranches.split(', ').join('\n  • ')}`;
      }
      
      // 显示简洁消息，带"查看详情"按钮
      vscode.window.showErrorMessage(mainMessage, t('button.viewDetails')).then(selection => {
        if (selection === t('button.viewDetails')) {
          vscode.window.showInformationMessage(detailsMessage, { modal: true });
        }
      });
    } else {
      // 部分失败但全部执行完的情况（continueOnError = true）
      const failedBranches = failedResults.map(r => r.targetBranch).join(', ');
      
      if (preset) {
        message = t('success.presetMergePartial', preset.name, sourceBranch, successBranches, failedBranches);
      } else {
        message = t('success.multipleMergePartial', sourceBranch, successBranches, failedBranches);
      }
      
      vscode.window.showWarningMessage(message);
    }
  }
}

/**
 * 执行合并操作的核心逻辑（统一处理进度和错误处理）
 */
async function executeMergeOperationsCore(
  operations: MergeOperation[],
  workspacePath: string,
  title: string,
  onResult?: (result: MultipleMergeResult) => void,
  skipSourceCheck: boolean = false
): Promise<MultipleMergeResult[]> {
  // 读取配置，决定出错时是否继续
  const config = vscode.workspace.getConfiguration("gitQuickMerge");
  const continueOnError = config.get<boolean>("continueOnError", false);

  return new Promise((resolve) => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: title,
        cancellable: false,
      },
      async (progress) => {
        // 在开始合并前检查历史残留的 worktrees
        progress.report({ message: t('progress.checkingStaleWorktrees') });
        await checkAndPromptStaleWorktrees();

        const results: MultipleMergeResult[] = [];

        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i];

          progress.report({
            message: t('progress.processingMultiple', (i + 1).toString(), operations.length.toString()) + ` - ${operation.displayName}`,
            increment: (i / operations.length) * 100
          });

          // 检查源分支是否有未推送的提交（除非跳过检查）
          if (!skipSourceCheck) {
            const shouldContinue = await checkAndHandleUnpushedCommits(workspacePath, operation.from);
            if (!shouldContinue) {
              // 如果用户取消，跳过这个合并操作
              continue;
            }
          }

          const result = await executeSingleMergeFlow(operation.to, operation.from, workspacePath);
          results.push(result);

          // 如果有结果回调，调用它
          if (onResult) {
            onResult(result);
          }

          // 如果合并失败且配置为不继续执行，则立即中断（不在这里显示错误，统一由结果显示函数处理）
          if (!result.success && !continueOnError) {
            break;
          }
        }

        resolve(results);
      }
    );
  });
}

/**
 * 执行预设合并流程
 */
export async function executePresetMergeFlow(preset: MergePreset): Promise<void> {
  // 按照配置顺序依次执行每个合并操作（最安全的方式）
  await executePresetMergeSequential(preset);
}

/**
 * 按照配置顺序依次执行预设合并
 */
async function executePresetMergeSequential(preset: MergePreset): Promise<void> {
  const workspacePath = getWorkspacePath();

  if (!workspacePath) {
    vscode.window.showErrorMessage(t('error.cannotGetBranchInfo'));
    return;
  }

  const configs = preset.branches;
  const operations: MergeOperation[] = configs.map(config => ({
    from: config.from,
    to: config.to,
    displayName: `${config.from} → ${config.to}`
  }));

  const allResults = await executeMergeOperationsCore(
    operations,
    workspacePath,
    t('progress.processingMultiple', '0', configs.length.toString()) + ` - ${preset.name}`
  );

  // 显示合并结果
  showMultipleMergeResults(allResults, operations.length, '', preset, configs.map(c => c.to), operations);
}