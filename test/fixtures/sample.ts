const MAX_SUPPLY = 1000;
let counter = 0;
const helper = require("./helper");

export class Router {
  readonly factory: string;
  private reserve = 0;
  #secret = 1;
  static readonly VERSION = "2";

  constructor(private readonly weth: string, factory: string) {
    this.factory = factory;
  }

  swap(amountIn: number, { path, to }: { path: string[]; to: string }, deadline = 0): number {
    const out = amountIn * 2 + this.reserve + this.#secret;
    counter += 1;
    path.forEach((hop, i) => console.log(hop, i, to, amountIn));
    if (deadline > MAX_SUPPLY) {
      const amountIn = 5;
      return amountIn;
    }
    return out + this.weth.length;
  }
}

function plain(a, b = a) {
  var c = a + b;
  return function inner(a) { return a + c; };
}
