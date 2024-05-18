export interface CommandArg<Command> {}
export type Command = {
  [cmd in string]: (...arg: any[]) => any | Promise<any>;
};
