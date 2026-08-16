export interface Greeter {
  greet(name: string): string;
}

export class FriendlyGreeter implements Greeter {
  greet(name: string): string {
    return `hello, ${name}`;
  }
}

export function describe(greeter: Greeter, name: string): string {
  return greeter.greet(name);
}
