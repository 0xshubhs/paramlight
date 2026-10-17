MAX_FEE = 30
registry = {}

class Pool:
    FEE = 3

    def __init__(self, token0, token1):
        self.token0 = token0
        self.token1 = token1
        self.reserve: int = 0

    def swap(self, amount_in: int, *path, to=None, **opts):
        global registry
        registry = {}
        out = amount_in * self.FEE + self.reserve
        squares = [amount_in * k for k in path]
        def inner(amount_in):
            return amount_in + out
        return out, lambda x: x + amount_in, MAX_FEE

def shadow(registry):
    return registry
