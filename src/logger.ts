import vscode from "vscode";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Git Quick Merge");
  }

  private get threshold(): number {
    const level = vscode.workspace
      .getConfiguration("gitQuickMerge")
      .get<LogLevel>("logLevel", "info");
    return LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.threshold;
  }

  private formatMessage(level: string, message: string, data?: unknown): string {
    const timestamp = new Date().toLocaleTimeString();
    let formattedMessage = `[${timestamp}] [${level}] ${message}`;

    if (data instanceof Error) {
      // Error 的 message/stack 不可枚举，JSON.stringify 只会得到 {}
      formattedMessage += `\n${data.stack || data.message}`;
    } else if (data !== undefined) {
      try {
        formattedMessage += `\n${JSON.stringify(data, null, 2)}`;
      } catch {
        formattedMessage += `\n${String(data)}`;
      }
    }

    return formattedMessage;
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }
    this.outputChannel.appendLine(this.formatMessage(level.toUpperCase(), message, data));
  }

  info(message: string, data?: unknown): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("warn", message, data);
  }

  error(message: string, error?: unknown): void {
    this.write("error", message, error);
  }

  debug(message: string, data?: unknown): void {
    this.write("debug", message, data);
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}

// 创建全局日志实例
export const logger = new Logger();
