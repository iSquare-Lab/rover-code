// Reference solutions: the shortest clear programs we know for each mission. They set each mission's par, and the
// tests prove every mission can be solved.
export const SOLUTIONS: Record<string, string> = {
  touchdown: `move()
move()
move()
move()
move()
`,
  bend: `move()
move()
move()
turn_right()
move()
move()
move()
`,
  'first-sample': `move()
move()
move()
pick()
move()
move()
move()
move()
`,
  'rock-garden': `move()
move()
turn_right()
move()
move()
pick()
turn_left()
move()
move()
move()
turn_left()
move()
move()
turn_right()
move()
move()
move()
turn_right()
move()
move()
`,
  'long-haul': `for step in range(15):
    move()
`,
  staircase: `for step in range(5):
    move()
    turn_right()
    move()
    turn_left()
move()
`,
  'sample-row': `for sample in range(5):
    move()
    move()
    pick()
move()
move()
`,
  square: `for side in range(3):
    for step in range(4):
        move()
    pick()
    turn_right()
for step in range(3):
    move()
`,
  'unknown-distance': `while ahead() != "lander":
    move()
move()
`,
  trench: `while here() != "lander":
    if ahead() == "rock":
        turn_left()
        if ahead() == "rock":
            turn_right()
            turn_right()
    move()
`,
  scatter: `while here() != "lander":
    move()
    if here() == "sample":
        pick()
`,
  craters: `while here() != "lander":
    if ahead() == "crater":
        turn_left()
        move()
        turn_right()
        move()
        move()
        turn_right()
        move()
        turn_left()
    else:
        move()
`,
  'about-turn': `def turn_around():
    turn_left()
    turn_left()

for step in range(4):
    move()
pick()
turn_around()
for step in range(11):
    move()
pick()
turn_around()
for step in range(4):
    move()
`,
  maze: `while here() != "lander":
    turn_right()
    while ahead() == "rock":
        turn_left()
    move()
`,
  sweep: `def collect():
    if here() == "sample":
        pick()

def row():
    collect()
    while ahead() != "rock" and ahead() != "lander":
        move()
        collect()

for line in range(5):
    row()
    if line == 4:
        move()
    elif line % 2 == 0:
        turn_right()
        move()
        turn_right()
    else:
        turn_left()
        move()
        turn_left()
`,
  'lost-samples': `while True:
    if here() == "sample":
        pick()
    turn_right()
    while ahead() == "rock":
        turn_left()
    move()
`,
};
