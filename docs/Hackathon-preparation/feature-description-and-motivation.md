# Give researchers time back with Atlas Search

HRI Hackathon Thailand 2026 · First-screening feature proposal · 22 October 2026

We propose Thai–English search across HumanoidTH to help researchers find relevant robotics information with less time spent searching at a screen. Our goal is to give them time back for breaks, outdoor activities and life beyond work.

## Feature description

Atlas Search will let researchers describe what they need in Thai, English or a mixture of both, then explore related public information from across Thailand Humanoid Atlas in one place. Results will bring together papers, code repositories, robot models, news, videos and other eligible public records. Researchers will be able to filter by content type, inspect the original stored text and follow available source links.

The feature is intended for HRI and robotics researchers, including research students beginning a project or exploring an unfamiliar topic. They may know the question they want to investigate without knowing the exact robot name, English terminology or section of the atlas to search. For example, a request about robots that support older adults could help them discover related research, code and robot records when the stored information supports those matches.

Each result will identify its content type and show the text available in the atlas. A title-only paper record will be labelled accordingly. Researchers can inspect what a result contains before deciding whether to investigate the source further.

## Motivation

Time spent trying another keyword, switching sections and opening unrelated records is time a researcher cannot use elsewhere. Our starting concern is the person sitting in front of the database, still trying to find useful material. We want to reduce that repetitive work.

Our proposed contribution to HRI Wellness Living Lab focuses on researchers' quality of life. We want discovery to take less of their day, leaving more opportunity to step away from the computer, take a break or spend time outdoors. The longer-term ambition is to support healthier work routines by reducing avoidable time spent searching at a screen.

## Why build it into HumanoidTH?

HumanoidTH already brings together several kinds of robotics information. A researcher investigating one topic may need a paper, a repository and a robot description, even though those records appear in different parts of the atlas. One search across these records can help the researcher follow the topic without deciding where to look first.

Thai–English discovery addresses another part of that task. Researchers should be able to describe a need in either language and find relevant records written in either language. Original text and source links will remain available so they can assess the material themselves.

Building this feature into the existing atlas will let researchers move from discovery to its existing records and sources. The search will cover the public robotics corpus, including wellness-related work such as eldercare.

## Expected benefits

| Benefit | What it means for the researcher |
| --- | --- |
| Less time spent searching | Reach useful starting material with fewer repeated queries and less movement between sections. |
| Less effort across languages | Search in Thai or English without first having to guess the wording used in a relevant record. |
| Easier assessment of results | See the record type, original stored text and available source link before deciding what to read next. |
| More room for life beyond the screen | Time saved on discovery creates an opportunity for breaks, outdoor activities and personal priorities. |

These are expected benefits. We will first test whether the feature reduces the time and effort needed to find relevant information. How researchers use the saved time, and whether it changes their health or quality of life, will require follow-up beyond the Hack Day demonstration.

## Demonstrating its value

We will compare the existing atlas journey with Atlas Search using comparable tasks and the same underlying records. The evaluation will record time to the first relevant source, task completion, repeated searches and users' reported effort. A relevance check will ensure that faster searching still leads to useful material.

The demo will include a wellness-related research task supported by actual atlas records, Thai and English queries, and inspection of the original text and source links. The proposal's delivery scope, schedule and acceptance checks are detailed in the [Feature Implementation Hack Day Plan](Hack-day-planning/feature-implementation-hack-day-plan.md). The [Feature Technical Design](feature-technical-design.md) explains how the search will work.
