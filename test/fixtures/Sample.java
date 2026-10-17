public class Sample {
    private static final int MAX = 10;
    private final String name;
    private int count;
    static int instances = 0;

    public Sample(String name) {
        this.name = name;
    }

    public int bump(int step, String... tags) {
        count += step;
        for (String tag : tags) {
            System.out.println(tag + name + this.count);
        }
        java.util.function.Function<Integer, Integer> f = x -> x + step;
        int count = 3;
        return f.apply(count) + MAX;
    }
}
