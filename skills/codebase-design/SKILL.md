---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when designing or improving a module's interface, deciding where a seam goes, judging whether an abstraction earns its keep, making code more testable — or when another skill needs the deep-module vocabulary.
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. The aim is leverage for callers, locality for maintainers, testability for everyone.

This is a reference to consult, not a session to run. It is language-agnostic; the examples happen to be TypeScript.

## Glossary

Use these terms exactly. Do not substitute "component", "service", "API" or "boundary" — consistent language is the point.

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, a class, an injected service, a repository, a package, a whole tier-spanning slice.

**Interface** — everything a caller must know to use the module correctly: the type signature, but also invariants, ordering constraints, error modes, required configuration and performance characteristics. *Avoid*: "API", "signature" — too narrow, they cover only the type-level surface.

**Implementation** — what is inside the module. Distinct from **adapter**: a thing can be a small adapter with a large implementation (a database-backed repository) or a large adapter with a small implementation (an in-memory fake).

**Depth** — leverage at the interface: how much behaviour a caller or test can exercise per unit of interface it has to learn. **Deep** = large behaviour behind a small interface. **Shallow** = the interface is nearly as complex as the implementation.

**Seam** — a place where you can alter behaviour without editing in that place; the *location* where a module's interface lives. Where to put the seam is a separate decision from what goes behind it. *Avoid*: "boundary".

**Adapter** — a concrete thing satisfying an interface at a seam. Describes the *role* it fills, not what is inside it.

**Leverage** — what callers get from depth: more capability per unit of interface learned. One implementation pays back across N call sites and M tests.

**Locality** — what maintainers get from depth: change, bugs, knowledge and verification concentrate in one place instead of spreading across callers. Fix once, fixed everywhere.

## Deep vs shallow

Deep module — small interface, lots of implementation:

```
┌─────────────────────┐
│   Small Interface   │  ← few methods, simple params
├─────────────────────┤
│ Deep Implementation │  ← complex logic hidden
└─────────────────────┘
```

Shallow module — large interface, thin implementation (avoid):

```
┌─────────────────────────────────┐
│        Large Interface          │  ← many methods, complex params
├─────────────────────────────────┤
│      Thin Implementation        │  ← just passes through
└─────────────────────────────────┘
```

When designing an interface, ask: can I reduce the number of methods? Can I simplify the parameters? Can I hide more complexity inside?

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, swappable parts; they simply are not part of its interface. A module may have **internal seams** (private, used by its own tests) as well as the **external seam** at its interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. Wanting to test *past* the interface means the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Do not introduce a seam unless something actually varies across it. This is the main defence against speculative generality.

## Rejected framings

- **Depth as a ratio of implementation lines to interface lines** — rewards padding the implementation. Use depth-as-leverage instead.
- **"Interface" as a language's `interface` keyword** or a class's public methods — too narrow; interface here includes every fact a caller must know.
- **"Boundary"** — overloaded with DDD's bounded context. Say **seam** or **interface**.

## Where the seams actually are

Tests live at seams, never against internals. **Agree the seams before writing tests** — write down which seams are under test and confirm them. You cannot test everything; agreeing the seams up front is how testing effort lands on critical paths and complex logic instead of every edge case.

Which seams are real in *this* repository is a project fact, not a design principle. Read `~/.claude/context/<repo-basename>/PROJECT.md` — its "Seams and test coverage" section records where a genuine test culture exists and where there is none.

When no overlay exists, establish it cheaply before proposing a seam:

```bash
git ls-files | grep -E '(\.(spec|test)\.[cm]?[jt]sx?|_test\.(go|py)|(^|/)test_[^/]*\.py|Tests?\.(java|kt|cs)|_spec\.rb)$' | cut -d/ -f1-2 | sort | uniq -c | sort -rn
```

Widen the pattern first if the repository names its tests some other way. Areas with near-zero test files have no seam culture yet. **Say that plainly** rather than proposing a test at a seam nobody maintains — a lone test in an untested area is usually deleted or left failing, and pretending otherwise is worse than admitting the gap.
