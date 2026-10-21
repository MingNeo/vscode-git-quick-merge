import vscode from "vscode";
import { getCurrentBranchName, getWorkspacePath, checkStaleWorktrees, cleanupStaleWorktrees } from "./utils";
import { t } from "./i18n";
import { executeFlow, checkAndPromptStaleWorktrees } from "./singleMerge";
import { executePresetMergeFlow, MergePreset, BranchMergeConfig } from "./multiMerge";
import { logger } from "./logger";

/**
 * 单分支配置类型
 */
export type BranchConfig = string | { to: string; from?: string; name?: string };

/**
 * 将单个条目标准化成 BranchMergeConfig（附带可选的显示名）
 * exported for testing
 */
export function normalizeBranchConfig(
  item: BranchConfig,
  currentBranch: string
): BranchMergeConfig & { name?: string } {
  if (typeof item === "string") {
    return { to: item, from: currentBranch };
  }
  return { to: item.to, from: item.from || currentBranch, name: item.name };
}

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

  // 获取单分支选项（package.json 中已定义默认值，无需再添加）
  const branchConfigs = config.get<BranchConfig[]>("branches") || [];

  // 标准化配置并过滤当前分支
  const normalizedBranches = branchConfigs
    .map(item => normalizeBranchConfig(item, currentBranch))
    .filter(cfg => cfg.to !== currentBranch);

  // 获取预设的多分支合并选项（不 mutate 原配置对象）
  const rawPresets = config.get<MergePreset[]>("mergePresets") || [];
  const validPresets = rawPresets
    .filter(preset => preset?.name && preset.branches?.length)
    .map(preset => ({
      ...preset,
      branches: preset.branches
        .map(item => normalizeBranchConfig(item as BranchConfig, currentBranch))
        .filter(cfg => cfg.to !== currentBranch), // 过滤掉目标分支是当前分支的操作
    }))
    .filter(preset => preset.branches.length > 0);

  // 构建选择项
  const CANCEL = t('button.exit');
  const quickPickItems: (vscode.QuickPickItem & {
    type: 'cancel' | 'single' | 'preset';
    targetBranch?: string;
    sourceBranch?: string;
    preset?: MergePreset;
  })[] = [
      { label: CANCEL, type: 'cancel' }
    ];

  // 添加单分支选项
  if (normalizedBranches.length > 0) {
    quickPickItems.push(
      ...normalizedBranches.map(cfg => {
        const fromDisplay = cfg.from === currentBranch ? `HEAD(${cfg.from})` : cfg.from;
        return {
          label: t('menu.singleMergeLabel', fromDisplay, cfg.to),
          description: cfg.name,
          type: 'single' as const,
          targetBranch: cfg.to,
          sourceBranch: cfg.from
        };
      })
    );
  }

  // 添加预设多分支选项

  if (validPresets.length > 0) {
    quickPickItems.push(
      ...validPresets.map(preset => {
        const branches = preset.branches as BranchMergeConfig[];
        const branchCount = branches.length;
        // 将每个合并操作单独一行显示，更清晰
        const branchDetails = branches.map((cfg, index) =>
          `${index + 1}. ${cfg.from} → ${cfg.to}`
        ).join('\n');

        return {
          label: `$(git-merge) ${preset.name}`,
          description: t('menu.multiMergeDetail', branchCount.toString()),
          detail: branchDetails,
          type: 'preset' as const,
          preset: preset
        };
      })
    );
  }

  logger.debug('构建选择项完成', {
    totalItems: quickPickItems.length,
    normalizedBranches: normalizedBranches,
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
          executeFlow(selected.targetBranch, selected.sourceBranch);
        } else if (selected.type === 'preset' && selected.preset) {
          const branches = selected.preset.branches as BranchMergeConfig[];

          if (branches.length === 1) {
            // 只有一个合并操作，直接执行
            const single = branches[0];
            executeFlow(single.to, single.from);
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
 * 手动触发的清理命令：给用户明确反馈
 */
async function runCleanupStaleWorktreesCommand(): Promise<void> {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    vscode.window.showErrorMessage(t('error.noWorkspace'));
    return;
  }

  const stale = checkStaleWorktrees(workspacePath);

  if (stale.length === 0) {
    vscode.window.showInformationMessage(t('success.noStaleWorktrees'));
    return;
  }

  const yes = t('button.confirm');
  const confirm = await vscode.window.showWarningMessage(
    t('prompt.cleanupStaleWorktrees') + ` (${stale.length})`,
    { modal: true },
    yes
  );

  if (confirm !== yes) {
    return;
  }

  const result = await cleanupStaleWorktrees(stale, workspacePath);
  if (result.failed === 0) {
    vscode.window.showInformationMessage(t('success.cleanupComplete', result.success.toString()));
  } else {
    vscode.window.showWarningMessage(
      t('error.cleanupFailed', `${result.success}/${result.success + result.failed}`)
    );
  }
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

  const cleanupDisposable = vscode.commands.registerCommand(
    "gitQuickMerge.cleanup-stale-worktrees",
    () => runCleanupStaleWorktreesCommand()
  );

  context.subscriptions.push(quickMergeDisposable);
  context.subscriptions.push(cleanupDisposable);
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
