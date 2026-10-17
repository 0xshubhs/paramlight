<?php
const MAX_FEE = 30;
define('MIN_FEE', 1);

class Pool {
    const FEE = 3;
    private int $reserve = 0;
    public readonly string $token;

    public function __construct(string $token) {
        $this->token = $token;
    }

    public function swap(int $amountIn, array $path, ?string $to = null): int {
        $out = $amountIn * self::FEE + $this->reserve;
        foreach ($path as $i => $hop) { $out += $i; }
        $f = fn($x) => $x + $amountIn;
        return $f($out) + MAX_FEE;
    }
}
