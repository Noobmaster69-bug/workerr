
export type Command = {
  [cmd in string]: ({ body, signal }: CommandArg) => any | Promise<any>;
};
export type CommandArg<TBody extends any = any> = { body?: TBody, signal?: AbortSignal }


export function createCommand<C extends Command>(command: C) {
  return command as unknown as {
    [key in keyof C]: (arg: Parameters<C[key]>[0]) => ReturnType<C[key]>
  }
}
