#include <vector>
constexpr int kMax = 8;
int g_calls = 0;

class Vault {
public:
    explicit Vault(int cap) : cap_(cap) {}
    int deposit(int amount, std::vector<int>& log) {
        balance_ += amount;
        log.push_back(this->balance_);
        g_calls++;
        int cap_ = 2;
        return balance_ + cap_ + kMax;
    }
    int peek() const;
private:
    int balance_ = 0;
    const int cap_;
    static constexpr int kFee = 3;
};

int Vault::peek() const { return balance_ + kFee; }

auto adder = [](int x, int y) { return x + y; };
