package pool

const MaxFee = 30

var registry = map[string]int{}

type Pool struct {
	reserve0, reserve1 uint64
	name string
}

func (p *Pool) Swap(amountIn uint64, path []string, to string) (out uint64, err error) {
	out = amountIn + p.reserve0
	for i, hop := range path {
		registry[hop] = i
	}
	if v, ok := registry[to]; ok {
		out += uint64(v) + MaxFee
	}
	f := func(amountIn uint64) uint64 { return amountIn * 2 }
	return f(out), nil
}
