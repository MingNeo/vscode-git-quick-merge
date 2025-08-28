import vscode from "vscode";

class Logger {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Git Quick Merge");
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toLocaleTimeString();
    let formattedMessage = `[${timestamp}] [${level}] ${message}`;

    if (data !== undefined) {
      formattedMessage += `\n${JSON.stringify(data, null, 2)}`;
    }

    return formattedMessage;
  }

  info(message: string, data?: any): void {
    const formattedMessage = this.formatMessage("INFO", message, data);
    this.outputChannel.appendLine(formattedMessage);
    console.log(formattedMessage);
  }

  warn(message: string, data?: any): void {
    const formattedMessage = this.formatMessage("WARN", message, data);
    this.outputChannel.appendLine(formattedMessage);
    console.warn(formattedMessage);
  }

  error(message: string, error?: any): void {
    const formattedMessage = this.formatMessage("ERROR", message, error);
    this.outputChannel.appendLine(formattedMessage);
    console.error(formattedMessage);
  }

  debug(message: string, data?: any): void {
    const formattedMessage = this.formatMessage("DEBUG", message, data);
    this.outputChannel.appendLine(formattedMessage);
    console.log(formattedMessage);
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
