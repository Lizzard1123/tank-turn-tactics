from functools import lru_cache


@lru_cache(maxsize=None)
def fibonacci(n: int) -> int:
    if n < 0:
        raise ValueError("n must be a non-negative integer")
    if n in (0, 1):
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)


def test_fibonacci():
    assert fibonacci(0) == 0
    assert fibonacci(1) == 1
    assert fibonacci(2) == 1
    assert fibonacci(10) == 55
    assert fibonacci(20) == 6765
    assert fibonacci(50) == 12586269025

    try:
        fibonacci(-1)
        assert False, "Should raise ValueError"
    except ValueError:
        pass

    print("All tests passed!")


if __name__ == "__main__":
    test_fibonacci()