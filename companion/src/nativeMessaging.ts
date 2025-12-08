type MessageHandler = (message: unknown) => void;

type ErrorHandler = (error: Error) => void;

export class NativeMessagingHost {
  private readonly messageHandler: MessageHandler;
  private readonly errorHandler: ErrorHandler;

  constructor(onMessage: MessageHandler, onError: ErrorHandler) {
    this.messageHandler = onMessage;
    this.errorHandler = onError;

    process.stdin.on('readable', this.handleReadable);
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('error', (error) => this.errorHandler(error as Error));
  }

  send(message: unknown): void {
    const json = JSON.stringify(message);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(Buffer.byteLength(json), 0);
    const payload = Buffer.from(json, 'utf8');
    process.stdout.write(Buffer.concat([lengthBuffer, payload]));
  }

  private handleReadable = (): void => {
    try {
      let chunk = process.stdin.read(4) as Buffer | null;
      if (!chunk) {
        return;
      }
      while (chunk) {
        const messageLength = chunk.readUInt32LE(0);
        const messageBuffer = process.stdin.read(messageLength) as Buffer | null;
        if (!messageBuffer) {
          return;
        }
        const json = messageBuffer.toString('utf8');
        try {
          const message = JSON.parse(json);
          this.messageHandler(message);
        } catch (error) {
          this.errorHandler(error as Error);
        }
        chunk = process.stdin.read(4) as Buffer | null;
      }
    } catch (error) {
      this.errorHandler(error as Error);
    }
  };
}
