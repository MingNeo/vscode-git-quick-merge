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
  canceled?: boolean;
}

/**
 * 执行单个分支的合并流程（用于多分支合并）
 */
async function executeSingleMergeFlow(
  targetBranch: string,
  sourceBranch: string,
  workspacePath: string,
  mergeRef: 'remote' | 'local' = 'remote'
): Promise<MultipleMergeResult> {
  const config = createWorktreeConfig(workspacePath, targetBranch, sourceBranch);

  try {
    await createWorktree(config.repoPath, config.worktreePath, targetBranch);
    await switchToTargetBranch(config.worktreePath, targetBranch);
    await pullLatestCode(config.worktreePath, targetBranch);

    // 获取合并前的 commit id
    const beforeMergeCommitId = getCurrentCommitId(config.worktreePath);

    await mergeBranch(config.worktreePath, sourceBranch, mergeRef);

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
 * 预设合并结果的整体状态
 */
export type OutcomeKind =
  | 'allSuccess'
  | 'allFailed'
  | 'userCanceled'          // 用户主动取消，之前没有失败
  | 'canceledWithFailures'  // 用户主动取消，之前已有失败（continueOnError = true 时可能出现）
  | 'abortedByError'
  | 'partialSuccess';

export interface ClassifiedResults {
  canceled: MultipleMergeResult[];
  failed: MultipleMergeResult[];
  success: MultipleMergeResult[];
  /** 因失败而中断：结果数小于总数、至少有一个真正的失败，且不是用户取消 */
  wasAborted: boolean;
  /** 用户主动终止（无论之前是否有失败） */
  wasUserCanceled: boolean;
  kind: OutcomeKind;
}

/**
 * 将结果集按照取消 / 失败 / 成功分类，并判断整体状态。
 * 抽为独立纯函数便于单测。
 */
export function classifyMergeResults(
  results: MultipleMergeResult[],
  totalOperations: number
): ClassifiedResults {
  const canceled = results.filter(r => r.canceled);
  const failed = results.filter(r => !r.success && !r.canceled);
  const success = results.filter(r => r.success);
  const wasUserCanceled = canceled.length > 0;
  const wasAborted = !wasUserCanceled && results.length < totalOperations && failed.length > 0;

  let kind: OutcomeKind;
  if (wasUserCanceled) {
    kind = failed.length > 0 ? 'canceledWithFailures' : 'userCanceled';
  } else if (failed.length === 0) {
    kind = 'allSuccess';
  } else if (wasAborted) {
    kind = 'abortedByError';
  } else if (success.length === 0) {
    kind = 'allFailed';
  } else {
    kind = 'partialSuccess';
  }

  return { canceled, failed, success, wasAborted, wasUserCanceled, kind };
}

/**
 * 把结果按 from → to 格式化成列表项；失败项附带错误信息。
 * 通过 operations 数组按位置取出对应的 from（results 里只有 targetBranch）。
 */
function formatPair(op: MergeOperation): string {
  return `  • ${op.from} → ${op.to}`;
}

function formatFailedPair(op: MergeOperation, err?: string): string {
  return `  • ${op.from} → ${op.to}: ${err ?? t('error.unknown')}`;
}

/**
 * 拼装详情弹窗内容，空分组跳过
 */
function buildDetails(sections: Array<[string, string[]]>): string {
  return sections
    .filter(([, lines]) => lines.length > 0)
    .map(([title, lines]) => `${title}:\n${lines.join('\n')}`)
    .join('\n\n');
}

/**
 * 普通通知不支持换行，只放一行摘要；完整列表通过"查看详情"在 modal 中展示
 */
function showWithDetails(level: 'info' | 'warning' | 'error', summary: string, details: string): void {
  const VIEW = t('button.viewDetails');
  const shown = level === 'error'
    ? vscode.window.showErrorMessage(summary, VIEW)
    : level === 'warning'
      ? vscode.window.showWarningMessage(summary, VIEW)
      : vscode.window.showInformationMessage(summary, VIEW);

  shown.then(selection => {
    if (selection === VIEW) {
      vscode.window.showInformationMessage(details, { modal: true });
    }
  });
}

/**
 * 显示预设合并结果
 *
 * operations[i] 与 results[i] 一一对应；results.length 可能小于 operations.length，
 * 此时尾部 operations 即为"未执行"的操作（出错中断或用户取消）。
 */
function showPresetMergeResults(
  results: MultipleMergeResult[],
  preset: MergePreset,
  operations: MergeOperation[]
): void {
  const totalOperations = operations.length;
  const { kind } = classifyMergeResults(results, totalOperations);

  const executed = operations.slice(0, results.length).map((op, i) => ({ op, r: results[i] }));
  const successOps = executed.filter(x => x.r.success).map(x => x.op);
  const failedPairs = executed.filter(x => !x.r.success && !x.r.canceled);
  // "未执行"包括两类：用户取消的那一步，以及后面没机会执行的尾部
  const notRunOps = [
    ...executed.filter(x => x.r.canceled).map(x => x.op),
    ...operations.slice(results.length),
  ];

  const successSection: [string, string[]] = [t('success.completedBranchesList'), successOps.map(formatPair)];
  const failedSection: [string, string[]] = [
    t('error.failedOperationsList'),
    failedPairs.map(({ op, r }) => formatFailedPair(op, r.error)),
  ];
  const notRunSection: [string, string[]] = [t('error.canceledOperationsList'), notRunOps.map(formatPair)];
  const details = buildDetails([successSection, failedSection, notRunSection]);

  switch (kind) {
    case 'allSuccess':
      showWithDetails('info', t('success.presetMergeComplete', preset.name, successOps.length.toString()), details);
      return;

    case 'userCanceled':
    case 'canceledWithFailures':
      // 第一步就取消：没有可展示的详情
      if (executed.length === 1) {
        vscode.window.showInformationMessage(t('warning.operationsCanceled', notRunOps.length.toString()));
        return;
      }
      showWithDetails(
        kind === 'canceledWithFailures' ? 'warning' : 'info',
        t('warning.presetCanceled',
          preset.name,
          successOps.length.toString(),
          failedPairs.length.toString(),
          notRunOps.length.toString()
        ),
        details
      );
      return;

    case 'allFailed':
      showWithDetails('error', t('error.presetAllFailed', preset.name, failedPairs.length.toString()), details);
      return;

    case 'abortedByError': {
      const failedFirst = failedPairs[0];
      const summary = t('error.mergeAbortedShort',
        failedFirst.op.to,
        successOps.length.toString(),
        totalOperations.toString(),
        notRunOps.length.toString()
      );

      let abortDetails = `❌ ${t('error.mergeAbortedTitle')}\n\n`;
      abortDetails += `${t('error.failedAt')}: ${failedFirst.op.from} → ${failedFirst.op.to}\n`;
      abortDetails += `${t('error.errorMessage')}: ${failedFirst.r.error || t('error.unknown')}\n\n`;
      abortDetails += `${t('progress.completed')}: ${successOps.length}/${totalOperations}\n`;
      abortDetails += `${t('progress.canceled')}: ${notRunOps.length}\n\n`;
      abortDetails += buildDetails([notRunSection, successSection]);

      showWithDetails('error', summary, abortDetails);
      return;
    }

    case 'partialSuccess':
      showWithDetails(
        'warning',
        t('success.presetMergePartial', preset.name, successOps.length.toString(), failedPairs.length.toString()),
        details
      );
      return;
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
          let mergeRef: 'remote' | 'local' = 'remote';
          if (!skipSourceCheck) {
            const decision = await checkAndHandleUnpushedCommits(workspacePath, operation.from);
            if (decision === 'cancel') {
              // 用户主动取消：记录为 canceled 并立即终止
              results.push({
                targetBranch: operation.to,
                success: false,
                canceled: true,
              });
              break;
            }
            if (decision === 'pushFailed') {
              // 推送失败属于真实失败（错误已通过 showErrorMessage 弹出），按 failure 处理
              const failResult: MultipleMergeResult = {
                targetBranch: operation.to,
                success: false,
                error: t('error.pushSourceFailed', operation.from),
              };
              results.push(failResult);
              if (onResult) {
                onResult(failResult);
              }
              if (!continueOnError) {
                break;
              }
              continue;
            }
            mergeRef = decision;
          }

          const result = await executeSingleMergeFlow(operation.to, operation.from, workspacePath, mergeRef);
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
 * 执行预设合并流程（按配置顺序依次执行，每步独立的 worktree 最安全）
 */
export async function executePresetMergeFlow(preset: MergePreset): Promise<void> {
  const workspacePath = getWorkspacePath();

  if (!workspacePath) {
    vscode.window.showErrorMessage(t('error.noWorkspace'));
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

  showPresetMergeResults(allResults, preset, operations);
}