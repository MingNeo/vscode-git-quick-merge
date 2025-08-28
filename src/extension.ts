import vscode from "vscode";
import { getCurrentBranchName, getWorkspacePath, checkStaleWorktrees, cleanupStaleWorktrees } from "./utils";
import { t } from "./i18n";
import { executeFlow } from "./singleMerge";
import { executePresetMergeFlow, MergePreset } from "./multiMerge";
import { logger } from "./logger";



/**
 * 主入口函数
 */
function manageWorktrees(statusBarItem?: vscode.StatusBarItem): void {
  // 立即隐藏tooltip
  if (statusBarItem) {
    statusBarItem.tooltip = "";
  }

  logger.info('快速合并功能被触发');

  const config = vscode.workspace.getConfiguration("gitQuickMerge");
  const currentBranch = getCurrentBranchName();

  logger.debug('获取当前分支信息', { currentBranch });
  logger.debug('读取配置信息', {
    branches: config.get<string[]>("branches"),
    mergePresets: config.get<MergePreset[]>("mergePresets"),
    remoteRepoName: config.get<string>("remoteRepoName")
  });

  if (!currentBranch) {
    logger.error('无法获取当前Git分支信息');
    vscode.window.showErrorMessage('无法获取当前Git分支信息，请确保当前工作区是一个Git仓库');
    logger.show(); // 自动显示输出面板
    return;
  }

  // 获取单分支选项
  const singleBranches = new Set(['develop', 'release', 'master', ...(config.get<string[]>("branches") || [])].filter(v => v !== currentBranch));

  // 获取预设的多分支合并选项
  const mergePresets = config.get<MergePreset[]>("mergePresets") || [];
  const validPresets = mergePresets.filter(preset => {
    if (!preset.name || !preset.branches || preset.branches.length === 0) {
      return false;
    }
    // 过滤掉当前分支
    preset.branches = preset.branches.filter(branch => branch !== currentBranch);
    return preset.branches.length > 0;
  });

  // 构建选择项
  const CANCEL = t('button.exit');
  const quickPickItems: (vscode.QuickPickItem & {
    type: 'cancel' | 'single' | 'preset';
    targetBranch?: string;
    preset?: MergePreset;
  })[] = [
      { label: CANCEL, type: 'cancel' }
    ];

  // 添加单分支选项
  if (singleBranches.size > 0) {
    quickPickItems.push(
      ...Array.from(singleBranches).map(branch => ({
        label: branch,
        description: `单分支合并`,
        type: 'single' as const,
        targetBranch: branch
      }))
    );
  }

  // 添加预设多分支选项
  if (validPresets.length > 0) {
    quickPickItems.push(
      ...validPresets.map(preset => ({
        label: `多分支合并: ${preset.branches.join(' + ')}`,
        description: preset.name,
        detail: `一键合并到 ${preset.branches.length} 个分支`,
        type: 'preset' as const,
        preset: preset
      }))
    );
  }

  logger.debug('构建选择项完成', {
    totalItems: quickPickItems.length,
    singleBranches: Array.from(singleBranches),
    validPresets: validPresets.map(p => ({ name: p.name, branches: p.branches }))
  });

  if (quickPickItems.length === 1) {
    logger.warn('没有可用的目标分支或预设');
    vscode.window.showWarningMessage('没有可用的目标分支或预设');
    logger.show();
    return;
  }

  logger.info('准备显示QuickPick选择框', {
    itemCount: quickPickItems.length,
    placeholder: t('prompt.selectTargetBranch')
  });

  vscode.window.showQuickPick(quickPickItems, {
    placeHolder: t('prompt.selectTargetBranch'),
    canPickMany: false,
    ignoreFocusOut: false
  })
    .then((selected) => {
      logger.debug('QuickPick返回结果', {
        selected: selected ? { type: selected.type, label: selected.label } : null
      });

      if (!selected || selected.type === 'cancel') {
        logger.info('用户取消了合并操作');
        return;
      }

      logger.info('用户选择了合并选项', {
        type: selected.type,
        label: selected.label,
        targetBranch: selected.targetBranch,
        preset: selected.preset ? { name: selected.preset.name, branches: selected.preset.branches } : undefined
      });

      try {
        if (selected.type === 'single' && selected.targetBranch) {
          executeFlow(selected.targetBranch);
        } else if (selected.type === 'preset' && selected.preset) {
          if (selected.preset.branches.length === 1) {
            executeFlow(selected.preset.branches[0]);
          } else {
            executePresetMergeFlow(selected.preset);
          }
        }
      } catch (error) {
        logger.error('执行合并流程时出错', error);
        vscode.window.showErrorMessage('执行合并时出错，请查看输出面板了解详情');
        logger.show();
      }
    }, (error) => {
      logger.error('QuickPick显示失败', error);
      vscode.window.showErrorMessage('显示选择框时出错，请查看输出面板了解详情');
      logger.show();
    });
}

/**
 * 检查并提示清理历史残留的 worktrees
 */
async function checkAndPromptStaleWorktrees(): Promise<void> {
  const staleWorktrees = checkStaleWorktrees();

  if (staleWorktrees.length === 0) {
    return;
  }

  const workspacePath = getWorkspacePath();
  await cleanupStaleWorktrees(staleWorktrees, workspacePath);
}

export function activate(context: vscode.ExtensionContext): void {
  logger.info('Git Quick Merge 扩展正在启动...');

  // 添加状态栏项
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10000
  );
  statusBarItem.command = "gitQuickMerge.quick-merge-to";
  statusBarItem.text = "$(git-branch) " + t('statusBar.title');
  statusBarItem.show();

  logger.info('状态栏项已创建');

  const quickMergeDisposable = vscode.commands.registerCommand(
    "gitQuickMerge.quick-merge-to",
    () => manageWorktrees(statusBarItem)
  );

  context.subscriptions.push(quickMergeDisposable);
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(logger); // 确保日志器在扩展停用时被清理

  logger.info('Git Quick Merge 扩展启动完成');

  // 延迟检查历史残留的 worktrees（避免影响扩展启动速度）
  setTimeout(async () => {
    const config = vscode.workspace.getConfiguration("gitQuickMerge");
    const skipCheck = config.get<boolean>("skipStaleWorktreeCheck", false);

    if (!skipCheck) {
      logger.info('开始检查历史残留的worktrees');
      await checkAndPromptStaleWorktrees();
    } else {
      logger.info('跳过历史残留worktrees检查（用户配置）');
    }
  }, 2000); // 2秒后检查
}

export function deactivate(): void { }
