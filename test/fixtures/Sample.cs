public class Sample
{
    private const int Max = 10;
    private readonly string name;
    private int count;
    public int Total { get; set; }

    public Sample(string name)
    {
        this.name = name;
    }

    public int Bump(int step, params string[] tags)
    {
        count += step;
        foreach (var tag in tags)
        {
            System.Console.WriteLine(tag + name + this.count + Total);
        }
        System.Func<int, int> f = x => x + step;
        return f(count) + Max;
    }
}
