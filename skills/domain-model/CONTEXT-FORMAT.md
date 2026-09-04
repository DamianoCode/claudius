# CONTEXT.md — format

Lives at `~/.claude/context/<repo-basename>/CONTEXT.md`. Never in the repository.

## Structure

```md
# <Nazwa kontekstu>

<Jedno-dwa zdania: czym jest ten kontekst i po co istnieje.>

## Język

**<Termin>**:
<Jedno-dwa zdania definicji: czym to JEST, nie co robi.>
_Avoid_: <odrzucone synonimy>

**<Kolejny termin>**:
<Definicja.>
_Avoid_: <odrzucone synonimy>
```

## Rules

- **Be opinionated.** When several words exist for one concept, pick the best and list the rest under `_Avoid_`. A glossary that permits synonyms does not reduce verbosity, which is its whole purpose.
- **Keep definitions tight.** One or two sentences. Define what it **is**, not what it does.
- **Only terms specific to this project.** General programming concepts — timeout, retry, cache, DTO — do not belong, however heavily the project uses them. Ask: is this concept unique to this domain, or general engineering? Only the former belongs.
- **No process terms.** Story points, epics, release branches and commit conventions are process, and they already live in the repository's own instructions.
- **Group under subheadings** when natural clusters emerge (OMS, WMS, PIM, integrations). A flat list is fine while the glossary is small.
- **Record ambiguities you resolved**, so the same argument is not reopened:

```md
## Rozstrzygnięte niejednoznaczności

- "<słowo>" znaczyło jednocześnie A i B.
  Rozstrzygnięcie: A = **<termin 1>**, B = **<termin 2>**.
```

## Bilingual note

Keep the term itself in whatever language the team actually speaks at the whiteboard, and give the identifier used in code alongside it when the two differ, so the glossary connects speech to symbols:

```md
**<Termin mówiony>** (`<IdentyfikatorWKodzie>`):
<Definicja.>
_Avoid_: <odrzucone synonimy>
```
