#include <stdio.h>
#define MAX_LEN 64
static const int LIMIT = 10;
int global_count = 0;

int sum(const int *values, size_t len, int (*cb)(int)) {
    int total = 0;
    for (size_t i = 0; i < len && i < MAX_LEN; i++) {
        total += cb(values[i]) + LIMIT;
        global_count++;
    }
    {
        int len = 3;
        total += len;
    }
    return total;
}
