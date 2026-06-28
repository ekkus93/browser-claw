type Msg = Record<string, unknown>;
type MsgResult = Record<string, unknown>;

export declare function handleReadPage(msg: Msg): Promise<MsgResult>;
export declare function handleReadPages(msg: Msg): Promise<MsgResult>;
export declare function handleGetStatus(msg: Msg): MsgResult;
export declare function handleRequestHostPermission(
  msg: Msg,
): Promise<MsgResult>;
export declare function handleReadCurrentTab(msg: Msg): MsgResult;
export declare const handlers: Record<string, (msg: Msg) => unknown>;
