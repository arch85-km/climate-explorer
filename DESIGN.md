# Design decisions

The decisions behind Climate Explorer, and my reasons for them.
[`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the code is organised, and
the [method notes](docs/climate-explorer-method-notes.html) describe what each
quantity computes, which published method it follows and what the tool does
not model. This file records why the tool is the way it is. Written in
October 2026, at version 1.1.0.

— Karam Al-Obaidi

## Why it exists

My students needed to read a weather file and understand the climate it
describes. What they had did not let them do that:

- **Online tools and Climate Consultant** offer a few fixed charts, which
  students could not change to ask their own question. They are built to
  produce outputs, not to show why a climate behaves as it does. And the
  psychrometrics, the sun path and the wind lived in separate tools, so
  students never saw them together.
- **Spreadsheets** meant working through 8,760 rows by hand, which hides the
  shape of the climate.

## Why it runs in the browser

- **Nothing to install.** No licence and no admin rights, on lab PCs or on
  students' own laptops.
- **Any device, and embeddable.** It runs on any machine, including older lab
  PCs, and sits inside my website.

## Method

### No weather data ships with it

The app opens empty, and students load their own EPW file.

- **Licensing.** Weather files carry their publishers' terms, and bundling
  one would redistribute it to every visitor.
- **Their own site.** Students should study the climate of their own project
  site, not a default city.
- **Finding the data.** Finding and choosing a weather file is itself part of
  what students should learn.

### Five analysis modes

The views are arranged into five modes: Thermal, Solar, Wind, Daylight and
Comfort.

- **A teaching workflow.** A tutor can step a class through a structured
  climate study, one mode at a time.
- **Fewer menus.** Each mode shows only the views and controls that matter,
  so students are not overwhelmed.
- **The designer's questions.** The modes match the questions a designer asks
  of a climate.

### A psychrometric chart with passive-strategy polygons

The comfort mode centres on a psychrometric chart with the Givoni–Milne
passive-strategy polygons.

- **The same as professional tools.** It is the construction Climate
  Consultant and Ladybug use, so students can move between them.
- **Strategies are the point.** Which passive strategy a climate rewards is
  the design question the chart answers.
- **Standard in teaching.** It is the chart students meet in textbooks and
  environmental design courses.

### 3D views

The sun path dome, the annual surface, the 3D wind rose and the massing study
sit beside the 2D charts.

- **Spatial understanding.** The sun's path and the shape of a year are
  easier to grasp in 3D than on a flat chart.
- **From climate to massing.** The massing view links the climate to a
  building's form and its shadow.
- **For presentations.** They work well projected in lectures and crits.

## Teaching

I use the tool in undergraduate and postgraduate teaching.

**The three exercises** in the method notes are mine:

1. A heating season is a shape, and a monthly mean hides it.
2. A climate rewards one passive strategy and refuses another.
3. Latitude fixes the sun and almost nothing else.

Three features came from how students and tutors used the tool:

- **Projection and print themes**: a dark theme for projectors, and a
  high-contrast one for print and PDF.
- **Compare mode**: two periods or two climates side by side.
- **PNG and CSV export**: a figure for the crit wall, and the numbers for a
  spreadsheet.

## What it leaves out

- **Any building.** No fabric, zones, gains or energy. It reads a climate,
  and a climate is not a building.
- **Full comfort models.** No radiant temperature, air speed, clothing or
  metabolic rate, and the ASHRAE 55 adaptive band is not yet wired in.
- **Climate change.** No trends or future-weather projections: a typical year
  is read as given.

## How a release is checked

Before I teach with a release:

- **I use the live site myself**, as a student would.
- **I work through the three exercises** and check that their answers still
  hold.

## Licensing and archiving

The code is MIT and the teaching material is CC BY 4.0:

- **The code is free to reuse.** Anyone can adapt or embed it.
- **The material is reusable with credit.** Other educators can use the notes
  and exercises in their own courses, crediting the source.
- **The cube mark is reserved from both**, so a modified copy cannot pass
  itself off as mine.
- **Open licensing is expected** of this kind of work by my university or
  funders.

Every version is archived on Zenodo with its own DOI:

- **Reproducible figures.** A reported number can be traced to the exact build
  that produced it.
- **A citable research output.** The software counts as an output in its own
  right.
- **A permanent archive.** Each version survives even if my website changes.
- **Credit when reused.** Anyone who uses it has a proper way to cite it.

## How this was developed

I designed the application. I defined the problem and the scope: what the tool
is for, who it is for and what it leaves out. I chose the methods and the
sources it relies on, and set the exercises. I tested it in use, found and
reported the bugs, judged whether each fix worked, and decided what was
released and when.

The code was written with an AI coding assistant, working to my specification
and direction. It wrote most of the code, drafted the documentation, which I
reviewed, diagnosed bugs and proposed fixes, which I then tested, and wrote and
ran the automated tests and release checks. I retain full intellectual
responsibility for the design, the methods and the results, including any
errors.

## Next

- **Adaptive comfort**: wire the ASHRAE 55 adaptive band, already
  implemented, into the interface.
- **More passive strategies**: the fuller Givoni–Milne set, such as passive
  solar heating and dehumidification.
- **Radiation on facades**: transpose radiation onto vertical and tilted
  surfaces.
- **Design conditions**: read and show the EPW's design-conditions header.
