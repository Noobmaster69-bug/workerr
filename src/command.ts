import { CommandArg, createCommand } from "workerr/utils"


export const cmd = createCommand({
    hello: async ({ signal, body }: CommandArg<{ alo: string }>) => {

        if (signal) {
            if (signal.aborted) {
                throw Error(signal.reason)
            } else {

                signal.onabort = () => {
                    console.log("Error")
                    throw Error(signal.reason)
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 5000))
        return Math.random()
    }
})
export type Cmd = typeof cmd