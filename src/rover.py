# The Rover Code world, in Python: the map, the rover, and the functions a player's program calls.
# The page sends a level's maps and the player's code to `run_level`; it answers with JSON: for each map, every
# step the rover took (with the line of code that took it), what it printed, and whether it reached the lander
# with every sample on board.
import json
import sys

DIRECTIONS = "NESW"
STEP = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}
ROVER = {"^": "N", ">": "E", "v": "S", "<": "W"}
NAMES = {"#": "rock", "o": "crater", "*": "sample", "L": "lander", ".": "clear"}
FILE = "<your program>"

# Generous limits: a program that runs past them is almost always stuck in a loop.
MAX_ACTIONS = 2000
MAX_LINES = 200_000
MAX_PRINTS = 200
MAX_PRINT_LENGTH = 300


# Both end a run from inside the player's program. They derive from BaseException, not Exception, so an
# `except Exception:` in the player's code does not catch them. A bare `except:` still could, so the World also
# remembers that the run is over and raises it again at the next action, sensor call or traced line (see
# World.check). Python turns tracing off once the tracer raises, so a program that then loops without calling the
# rover is ended by the page's time limit. This guards against mistakes, not cheating: the scores live only in the
# player's own browser.
class Stop(BaseException):
    """Ends a run: the rover crashed, or a limit was reached."""

    def __init__(self, message, line=0):
        super().__init__(message)
        self.message = message
        self.line = line


class Arrived(BaseException):
    """Ends a run early: the rover is on the lander with every sample."""


def user_line():
    """The line of the player's program running now: the innermost frame from their file."""
    frame = sys._getframe(1)
    while frame is not None and frame.f_code.co_filename != FILE:
        frame = frame.f_back
    return frame.f_lineno if frame is not None else 0


class World:
    def __init__(self, rows):
        self.grid = []
        self.x = self.y = 0
        self.facing = "E"
        for y, row in enumerate(rows):
            cells = []
            for x, ch in enumerate(row):
                if ch in ROVER:
                    self.x, self.y, self.facing = x, y, ROVER[ch]
                    ch = "."
                cells.append(ch)
            self.grid.append(cells)
        self.height = len(self.grid)
        self.width = max(len(r) for r in self.grid)
        self.left = sum(r.count("*") for r in self.grid)
        self.samples = self.left
        self.actions = 0
        self.trace = []
        self.output = []
        # Set when the run is over, so a program that catches Stop or Arrived cannot carry on.
        self.stopped = None
        self.arrived = False

    def at(self, x, y):
        if 0 <= y < self.height and 0 <= x < len(self.grid[y]):
            return self.grid[y][x]
        return None

    def record(self, kind, note=None):
        self.trace.append([kind, self.x, self.y, self.facing, self.left, user_line(), note])

    def stop(self, message, kind=None):
        """Ends the run: records the crash when `kind` is given, then raises Stop."""
        if kind:
            self.record(kind, message)
        self.stopped = Stop(message, user_line())
        raise self.stopped

    def check(self):
        """Raises again whatever ended the run, in case the player's program caught it."""
        if self.stopped is not None:
            raise self.stopped
        if self.arrived:
            raise Arrived()

    def act(self):
        self.check()
        self.actions += 1
        if self.actions > MAX_ACTIONS:
            self.stop(f"The rover made {MAX_ACTIONS} moves without finishing. Is a loop missing a way out?")

    def done(self):
        return self.at(self.x, self.y) == "L" and self.left == 0

    # The player's functions.

    def move(self):
        self.act()
        dx, dy = STEP[self.facing]
        nx, ny = self.x + dx, self.y + dy
        ahead = self.at(nx, ny)
        if ahead is None:
            self.stop("The rover would drive off the map.", "crash")
        if ahead == "#":
            self.stop("The rover hit a rock.", "crash")
        self.x, self.y = nx, ny
        if ahead == "o":
            self.stop("The rover drove into a crater.", "crater")
        self.record("move")
        if self.done():
            self.arrived = True
            raise Arrived()

    def turn_left(self):
        self.act()
        self.facing = DIRECTIONS[(DIRECTIONS.index(self.facing) + 3) % 4]
        self.record("turn")

    def turn_right(self):
        self.act()
        self.facing = DIRECTIONS[(DIRECTIONS.index(self.facing) + 1) % 4]
        self.record("turn")

    def pick(self):
        self.act()
        if self.at(self.x, self.y) != "*":
            self.stop("There is no sample here to pick up.", "miss")
        self.grid[self.y][self.x] = "."
        self.left -= 1
        self.record("pick")

    def ahead(self):
        self.check()
        dx, dy = STEP[self.facing]
        cell = self.at(self.x + dx, self.y + dy)
        seen = "edge" if cell is None else NAMES.get(cell, "clear")
        self.record("look", seen)
        return seen

    def here(self):
        self.check()
        seen = NAMES.get(self.at(self.x, self.y), "clear")
        self.record("look", seen)
        return seen

    def samples_left(self):
        self.check()
        self.record("look", str(self.left))
        return self.left

    def facing_name(self):
        self.check()
        self.record("look", self.facing)
        return self.facing

    def say(self, *values, sep=None, end=None, **_):
        # Like print(), where `sep` and `end` may be None. Each call is one line in the rover log.
        if len(self.output) > MAX_PRINTS:
            return
        if len(self.output) == MAX_PRINTS:
            text = f"(More than {MAX_PRINTS} lines printed: the rest is not shown.)"
        else:
            sep = " " if sep is None else str(sep)
            end = "" if end is None or end == "\n" else str(end)
            text = (sep.join(str(v) for v in values) + end)[:MAX_PRINT_LENGTH]
        line = user_line()
        self.output.append([line, text])
        # Also in the trace, so the replay shows it when that line runs.
        self.trace.append(["print", self.x, self.y, self.facing, self.left, line, text])

    def no_input(self, *_):
        self.stop("Programs here can't ask for input. Use ahead(), here() and samples_left() to look around.")


def describe_error(error):
    # The message a learner needs: the line in their program and Python's own words, which in 3.14 often suggest the
    # right name ("Did you mean: 'move'?").
    tb = error.__traceback__
    line = 0
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    if isinstance(error, SyntaxError):
        return error.lineno or 0, f"SyntaxError: {error.msg}"
    name = type(error).__name__
    text = str(error)
    return line, f"{name}: {text}" if text else name


def run_map(rows, code):
    world = World(rows)
    world.record("start")
    names = {
        "move": world.move,
        "turn_left": world.turn_left,
        "turn_right": world.turn_right,
        "pick": world.pick,
        "ahead": world.ahead,
        "here": world.here,
        "samples_left": world.samples_left,
        "facing": world.facing_name,
        "print": world.say,
        "input": world.no_input,
        "__name__": "__main__",
    }
    result = {"ok": False, "message": "", "line": 0}
    lines_run = 0

    def tracer(frame, event, arg):
        nonlocal lines_run
        if frame.f_code.co_filename != FILE:
            return None
        if event == "line":
            world.check()
            lines_run += 1
            if lines_run > MAX_LINES:
                message = "Your program ran for a very long time without finishing. Is a loop missing a way out?"
                world.stopped = Stop(message, frame.f_lineno)
                raise world.stopped
        return tracer

    try:
        program = compile(code, FILE, "exec")
    except SyntaxError as error:
        line, message = describe_error(error)
        result.update(message=message, line=line, kind="syntax", trace=world.trace, output=world.output, actions=0)
        return result
    sys.settrace(tracer)
    try:
        exec(program, names)
    except (Arrived, Stop):
        pass  # read from the World below, which the program cannot hide
    except RecursionError as error:
        line, _ = describe_error(error)
        result.update(message="RecursionError: a function kept calling itself.", line=line, kind="error")
    except Exception as error:  # the player's own mistake: show it like Python would
        line, message = describe_error(error)
        result.update(message=message, line=line, kind="error")
    finally:
        sys.settrace(None)
    if world.stopped is not None:
        result.update(message=world.stopped.message, line=world.stopped.line, kind="stop")
    elif world.arrived or (not result["message"] and world.done()):
        result.update(ok=True, message="", line=0, kind="done")
    elif result["message"]:
        pass
    elif world.left:
        result.update(message=f"{world.left} sample{'s' if world.left != 1 else ''} still to collect.", kind="short")
    elif world.samples:
        result.update(message="Every sample is on board, but the rover is not on the lander.", kind="short")
    else:
        result.update(message="The program ended before the rover reached the lander.", kind="short")
    result.update(trace=world.trace, output=world.output, actions=world.actions)
    return result


def run_level(maps_json, code):
    maps = json.loads(maps_json)
    return json.dumps([run_map(rows, code) for rows in maps])
