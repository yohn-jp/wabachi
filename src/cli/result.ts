import * as z from "zod";

const jsonValue = z.json();
const machineOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("json"), value: jsonValue }),
]);

export const wabachiCommandResult = z.object({
  text: z.string(),
  machine: machineOutput,
});

export type WabachiCommandResult = z.output<typeof wabachiCommandResult>;
export type WabachiMachineOutput = WabachiCommandResult["machine"];

export function textMachine(value: string): WabachiMachineOutput {
  return { kind: "text", value };
}

export function jsonMachine(value: unknown): WabachiMachineOutput {
  return { kind: "json", value: jsonValue.parse(value) };
}

export function commandOutput(text: string, machine: WabachiMachineOutput): WabachiCommandResult {
  return { text, machine };
}

export class WabachiDomainError extends Error {
  constructor(
    readonly output: WabachiCommandResult,
    readonly streams: {
      readonly text: "stdout" | "stderr";
      readonly machine: "stdout" | "stderr";
    } = { text: "stderr", machine: "stdout" },
  ) {
    super(output.text.trimEnd());
    this.name = "WabachiDomainError";
  }
}

export function wabachiDomainError(
  text: string,
  machine: WabachiMachineOutput,
  streams?: WabachiDomainError["streams"],
): WabachiDomainError {
  return new WabachiDomainError({ text, machine }, streams);
}
