MAX_FEE = 30
$registry = {}

class Pool
  FEE = 3

  def initialize(token0, token1 = nil)
    @token0 = token0
    @reserve = 0
  end

  def swap(amount_in, *path, to: nil, **opts, &blk)
    out = amount_in * FEE + @reserve
    path.each_with_index { |hop, i| $registry[hop] = i + amount_in }
    out + MAX_FEE
  end
end
