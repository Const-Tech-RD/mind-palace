import { ipcMain } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/ipc'

/** Registers a handler for one channel of the shared contract, fully typed. */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>
): void {
  ipcMain.handle(channel, (_event, request: IpcRequest<C>) => handler(request))
}
