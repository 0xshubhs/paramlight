const MAX: u64 = 100;
static mut COUNTER: u64 = 0;
static NAME: &str = "x";

struct Pair {
    reserve0: u64,
    reserve1: u64,
}

impl Pair {
    fn swap(&mut self, amount_in: u64, (a, b): (u64, u64), mut to: String) -> u64 {
        let out = amount_in + self.reserve0 + MAX;
        let out = out + a;
        to.push_str("x");
        unsafe { COUNTER += 1; }
        let f = |x: u64| x + amount_in;
        match out { n if n > b => n, _ => f(out) }
    }
}
