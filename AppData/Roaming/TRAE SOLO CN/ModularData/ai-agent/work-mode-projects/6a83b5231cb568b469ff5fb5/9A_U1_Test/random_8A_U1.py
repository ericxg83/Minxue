import random
random.seed(20260820)

# Part I: 12 words x 2 = 24 items
part1_words = ['litre','factory','billion','salty','rest','rare','presentation','useful','boring','chemical','treatment','include']
p1 = [(i, c) for i in range(12) for c in (0, 1)]

# Part II: 15 phrases x 2 = 30 items
part2_phrases = [
  'take in','facts about water','sea water','fresh water','water cycle',
  'take great pride','share something new','waste energy','make water less safe for drinking',
  'encourage everyone to save water','turn off the tap','take shorter showers',
  'countless methods','a cotton shirt','on the Earth'
]
p2 = [(i, c) for i in range(15) for c in (0, 1)]

# Part III: 6 topics x 5 = 30 items
topics = ['enough','more_than','how_much_many','take_pride','shall_we','the_comparative']
p3 = [(i, c) for i in range(6) for c in range(5)]

def shuffle_no_adjacent(items):
    for _ in range(5000):
        s = items[:]
        random.shuffle(s)
        ok = True
        for k in range(len(s) - 1):
            if s[k][0] == s[k+1][0]:
                ok = False
                break
        if ok:
            return s
    return s

p1s = shuffle_no_adjacent(p1)
p2s = shuffle_no_adjacent(p2)
p3s = shuffle_no_adjacent(p3)

print("=== Part I (24) ===")
for idx, (i, c) in enumerate(p1s):
    print(f"  Q{idx+1:02d} = w{i:02d} ({part1_words[i]}) copy{c}")
print()
print("=== Part II (30) ===")
for idx, (i, c) in enumerate(p2s):
    print(f"  Q{idx+1:02d} = p{i:02d} ({part2_phrases[i]}) copy{c}")
print()
print("=== Part III (30) ===")
for idx, (i, c) in enumerate(p3s):
    print(f"  Q{idx+1:02d} = {topics[i]} q{c}")
