# vscode-git-quick-merge


![Configuration](./media/config.png)

![Example](./media/1.png)

---

快速将当前分支合并到指定分支，无需切换分支。

A VSCode extension for quickly merging the current branch to specified branches without switching branches.


### Features

- **快速分支合并**：无需切换到目标分支，直接将当前分支合并到指定分支
- **Quick Branch Merge**: Merge current branch to specified target branches without switching away from your current branch

- **无干扰**：使用 git worktree，当前工作目录文件不会被变更，不会中断或影响正在进行的构建/开发环境
- **Non-disruptive**: Uses git worktree to ensure files in your current working directory remain unchanged, preventing interruption to ongoing builds or development environments

- **自定义目标分支**：在设置中配置你常用的目标分支（develop、release、master 等）
- **Configurable Target Branches**: Set up your preferred target branches (develop, release, master, etc.) in settings

- **历史残留清理**：自动检测并清理失败残留的 worktree 目录
- **Stale Worktree Cleanup**: Automatically detect and clean up leftover worktree directories

---

**Enjoy!**
