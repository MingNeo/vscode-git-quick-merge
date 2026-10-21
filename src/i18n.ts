import * as vscode from 'vscode';

// 中文文本映射
const zhCnTexts: Record<string, string> = {
  'statusBar.title': '快速合并',
  // 进度提示
  'progress.processing': '处理分支合并',
  'progress.processingMultiple': '处理多分支合并 ({0}/{1})',
  'progress.checkingStaleWorktrees': '检查历史残留的 worktrees...',
  'progress.creatingWorktree': '创建临时工作区...',
  'progress.switchingBranch': '切换到目标分支...',
  'progress.pullingCode': '拉取最新代码...',
  'progress.mergingBranch': '合并分支...',
  'progress.pushingToRemote': '推送到远程...',
  'progress.mergeComplete': '合并流程完成',
  'progress.pushingBranch': '推送分支 "{0}"',
  'progress.preparingPush': '准备推送到远程仓库...',
  'progress.connectingRemote': '正在连接远程仓库...',
  'progress.pushComplete': '推送完成，更新远程分支...',
  'progress.completed': '已完成',
  'progress.canceled': '已取消',

  // 成功消息
  'success.mergeComplete': '✅ 分支合并成功: {0} → {1}',
  'success.presetMergeComplete': '✅ 预设合并 "{0}" 完成（{1} 个操作）',
  'success.presetMergePartial': '⚠️ 预设合并 "{0}" 部分成功：成功 {1} 个，失败 {2} 个',
  'success.pushComplete': '✅ 分支 "{0}" 推送成功',
  'success.completedBranches': '✅ 已成功合并的分支: {0}',
  'success.completedBranchesList': '已成功合并的分支',

  // 警告消息
  'warning.noNewCommits': '⚠️ 合并完成，但没有新的提交: {0} → {1}\n请检查源分支是否未推送到远程仓库',
  'warning.unpushedCommits': '当前分支 "{0}" 有 {1} 个未推送的提交。{2}\n\n建议先推送到远程仓库再进行合并，以确保合并操作基于最新的远程状态。',
  'warning.continueWithoutPush': '⚠️ 将在有未推送提交的情况下继续合并',
  'warning.operationsSkipped': '⚠️ 由于出错中断，有 {0} 个操作未执行',
  'warning.operationsCanceled': '🚫 已取消，{0} 个操作未执行',
  'warning.presetCanceled': '🚫 预设合并 "{0}" 已取消：成功 {1} 个，失败 {2} 个，未执行 {3} 个',

  // 错误消息
  'error.mergeFailed': '❌ 合并失败，已中断操作: {0} → {1}\n错误信息: {2}',
  'error.mergeFailedGeneral': '❌ 分支合并失败 {0} → {1}: {2}',
  'error.mergeAborted': '❌ 合并到 {0} 时失败，已中断后续操作\n错误: {1}\n\n已完成: {2}/{3} 个操作\n已取消: {4} 个操作',
  'error.mergeAbortedShort': '❌ 合并到 {0} 时失败，已中断（完成 {1}/{2}，取消 {3} 个），可能存在代码冲突，请自行手工合并',
  'error.mergeAbortedTitle': '多分支合并已中断',
  'error.failedAt': '失败位置',
  'error.errorMessage': '错误信息',
  'error.unknown': '未知错误',
  'error.canceledOperations': '已取消的操作: {0}',
  'error.canceledOperationsList': '已取消的操作',
  'error.failedOperationsList': '失败的操作',
  'error.pushFailed': '❌ 推送失败: {0}',
  'error.pushSourceFailed': '推送源分支 "{0}" 失败',
  'error.fetchSourceFailed': '拉取远程源分支 "{0}" 失败',
  'error.cannotGetBranchInfo': '无法获取必要的分支或路径信息',
  'error.noWorkspace': '未找到工作区目录，请确保已打开一个 Git 仓库',
  'error.presetAllFailed': '❌ 预设合并 "{0}" 全部失败（{1} 个操作）',
  'error.createWorktreeFailed': '创建工作区失败，请检查分支是否存在',
  'error.switchBranchFailed': '切换到目标分支失败，请检查分支是否存在',
  'error.pullCodeFailed': '拉取{0}代码失败',
  'error.mergeBranchFailed': '合并分支失败，可能存在代码冲突，请自行手工合并',
  'error.pushToRemoteFailed': '推送失败，请检查权限和网络',

  // 选择提示
  'prompt.selectTargetBranch': '选择合并方式',
  'prompt.selectMultipleTargetBranches': '选择要合并到的多个目标分支（可多选）',
  'prompt.selectMergePreset': '选择预设的合并组合',
  'prompt.cleanupStaleWorktrees': '清理历史残留的 Worktrees',

  // 菜单选项
  'menu.singleMergeLabel': '单分支合并: {0} → {1}',
  'menu.multiMergeLabel': '多分支合并: {0} → {1}',
  'menu.multiMergeDetail': '一键合并到 {0} 个分支',

  // 按钮文本
  'button.pushAndContinue': '推送并继续合并',
  'button.continueWithoutPush': '不推送，直接合并',
  'button.cancel': '取消操作',
  'button.exit': '退出操作',
  'button.viewDetails': '查看详情',
  'button.confirm': '确定',
  'button.mergeLocalLatest': '合并本地最新版本（包含未推送提交）',

  // 清理相关
  'progress.cleanupStaleWorktrees': '清理历史残留的 Worktrees',
  'progress.cleanupComplete': '清理完成',
  'success.noStaleWorktrees': '没有发现历史残留的 worktree 目录',
  'success.cleanupComplete': '✅ 成功清理了 {0} 个历史残留的 worktree 目录',
  'error.cleanupFailed': '❌ 清理失败: {0}',

  // 其他
  'commits.recent': '\n\n最近的提交:\n{0}{1}',
  'commits.andMore': '\n... 还有 {0} 个提交',
  'cleanup.warning': '清理worktree失败:',
};

// 英文文本映射
const enTexts: Record<string, string> = {
  'statusBar.title': 'Quick Merge',
  // 进度提示
  'progress.processing': 'Processing branch merge',
  'progress.processingMultiple': 'Processing multiple branch merge ({0}/{1})',
  'progress.checkingStaleWorktrees': 'Checking for stale worktrees...',
  'progress.creatingWorktree': 'Creating temporary worktree...',
  'progress.switchingBranch': 'Switching to target branch...',
  'progress.pullingCode': 'Pulling latest code...',
  'progress.mergingBranch': 'Merging branch...',
  'progress.pushingToRemote': 'Pushing to remote...',
  'progress.mergeComplete': 'Merge process complete',
  'progress.pushingBranch': 'Pushing branch "{0}"',
  'progress.preparingPush': 'Preparing to push to remote repository...',
  'progress.connectingRemote': 'Connecting to remote repository...',
  'progress.pushComplete': 'Push complete, updating remote branch...',
  'progress.completed': 'Completed',
  'progress.canceled': 'Canceled',

  // 成功消息
  'success.mergeComplete': '✅ Branch merge successful: {0} → {1}',
  'success.presetMergeComplete': '✅ Preset merge "{0}" completed ({1} operation(s))',
  'success.presetMergePartial': '⚠️ Preset merge "{0}" partially successful: {1} succeeded, {2} failed',
  'success.pushComplete': '✅ Branch "{0}" pushed successfully',
  'success.completedBranches': '✅ Successfully merged branches: {0}',
  'success.completedBranchesList': 'Successfully merged branches',

  // 警告消息
  'warning.noNewCommits': '⚠️ Merge completed but no new commits: {0} → {1}\nPlease check if source branch has been pushed to remote repository',
  'warning.unpushedCommits': 'Current branch "{0}" has {1} unpushed commits.{2}\n\nIt is recommended to push to remote repository first before merging to ensure merge operation is based on latest remote state.',
  'warning.continueWithoutPush': '⚠️ Will continue merging with unpushed commits',
  'warning.operationsSkipped': '⚠️ {0} operation(s) skipped due to error abort',
  'warning.operationsCanceled': '🚫 Canceled, {0} operation(s) not executed',
  'warning.presetCanceled': '🚫 Preset merge "{0}" canceled: {1} succeeded, {2} failed, {3} not executed',

  // 错误消息
  'error.mergeFailed': '❌ Merge failed, operation aborted: {0} → {1}\nError: {2}',
  'error.mergeFailedGeneral': '❌ Branch merge failed {0} → {1}: {2}',
  'error.mergeAborted': '❌ Merge to {0} failed, subsequent operations aborted\nError: {1}\n\nCompleted: {2}/{3} operations\nCanceled: {4} operation(s)',
  'error.mergeAbortedShort': '❌ Merge to {0} failed, aborted (completed {1}/{2}, canceled {3}), there may be code conflicts, please merge manually',
  'error.mergeAbortedTitle': 'Multi-branch merge aborted',
  'error.failedAt': 'Failed at',
  'error.errorMessage': 'Error message',
  'error.unknown': 'Unknown error',
  'error.canceledOperations': 'Canceled operations: {0}',
  'error.canceledOperationsList': 'Canceled operations',
  'error.failedOperationsList': 'Failed operations',
  'error.pushFailed': '❌ Push failed: {0}',
  'error.pushSourceFailed': 'Failed to push source branch "{0}"',
  'error.fetchSourceFailed': 'Failed to fetch remote source branch "{0}"',
  'error.cannotGetBranchInfo': 'Cannot get necessary branch or path information',
  'error.noWorkspace': 'No workspace directory found, please open a Git repository',
  'error.presetAllFailed': '❌ Preset merge "{0}" all failed ({1} operation(s))',
  'error.createWorktreeFailed': 'Failed to create worktree, please check if branch exists',
  'error.switchBranchFailed': 'Failed to switch to target branch, please check if branch exists',
  'error.pullCodeFailed': 'Failed to pull {0} code',
  'error.mergeBranchFailed': 'Failed to merge branch, there may be code conflicts, please merge manually',
  'error.pushToRemoteFailed': 'Push failed, please check permissions and network',

  // 选择提示
  'prompt.selectTargetBranch': 'Select merge option',
  'prompt.selectMultipleTargetBranches': 'Select multiple target branches to merge to (multi-select)',
  'prompt.selectMergePreset': 'Select merge preset',
  'prompt.cleanupStaleWorktrees': 'Cleanup stale worktrees',

  // 菜单选项
  'menu.singleMergeLabel': 'Single branch merge: {0} → {1}',
  'menu.multiMergeLabel': 'Multi branch merge: {0} → {1}',
  'menu.multiMergeDetail': 'Merge to {0} branches in one click',

  // 按钮文本
  'button.pushAndContinue': 'Push and continue merge',
  'button.continueWithoutPush': 'Continue without push',
  'button.cancel': 'Cancel operation',
  'button.exit': 'Exit operation',
  'button.viewDetails': 'View Details',
  'button.confirm': 'OK',
  'button.mergeLocalLatest': 'Merge local latest (including unpushed commits)',

  // 清理相关
  'progress.cleanupStaleWorktrees': 'Cleanup stale worktrees',
  'progress.cleanupComplete': 'Cleanup complete',
  'success.noStaleWorktrees': 'No stale worktree directories found',
  'success.cleanupComplete': '✅ Successfully cleaned up {0} stale worktree directories',
  'error.cleanupFailed': '❌ Cleanup failed: {0}',

  // 其他
  'commits.recent': '\n\nRecent commits:\n{0}{1}',
  'commits.andMore': '\n... and {0} more commits',
  'cleanup.warning': 'Failed to cleanup worktree:',
};

/**
 * 获取本地化文本
 */
export function t(key: string, ...args: string[]): string {
  const locale = vscode.env.language;
  const texts = locale.startsWith('zh') ? zhCnTexts : enTexts;

  let text = texts[key] || key;

  // 替换占位符 {0}, {1}, {2}, ...
  args.forEach((arg, index) => {
    text = text.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
  });

  return text;
}

/**
 * 检查当前是否为中文环境
 */
export function isChinese(): boolean {
  return vscode.env.language.startsWith('zh');
}
