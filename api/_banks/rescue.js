// Authored drill bank — Grade Rescue
// Questions are fixed and keyed: api/quiz.js grades them deterministically, no model call.
module.exports = {
  "id": "rescue",
  "title": "Grade Rescue",
  "note": "Authored bank for Carter Koh (11th grade): the two graded categories that hold his marks below a C. AP Biology unit tests are 50% of that grade (running 58.9%, needs 66.8%); AP English Language quizzes/projects are 30% (running 46.7%, needs 68.3%). Strict alternation, fixed order, deterministic grading — no model call, no drift.",
  "questions": [
    {
      "n": 1,
      "course": "AP Biology",
      "unit": "Cellular Energetics",
      "stem": "A drug blocks the electron transport chain in a muscle cell. Which best predicts the immediate consequence?",
      "options": [
        "Glycolysis stops, because glycolysis requires oxygen",
        "ATP synthesis by oxidative phosphorylation falls and fermentation to lactate increases",
        "The Krebs cycle speeds up to compensate for the lost ATP",
        "Pyruvate is no longer produced from glucose"
      ],
      "answer": "B",
      "why": "Blocking the chain stops NADH from being reoxidized, so the proton gradient and oxidative ATP collapse; the cell regenerates NAD+ by fermenting pyruvate to lactate."
    },
    {
      "n": 2,
      "course": "AP English Language",
      "unit": "Rhetorical analysis",
      "stem": "\"We buried my brother on a Tuesday,\" she told the board, \"and on Wednesday the council met to discuss the budget.\" The dominant appeal in this sentence is",
      "options": [
        "logos, resting on statistical evidence",
        "pathos, drawing on grief and the timing of the two events",
        "ethos, establishing her professional credentials",
        "an appeal to authority, citing the council"
      ],
      "answer": "B",
      "why": "The sentence works through emotion and juxtaposition of private loss against bureaucratic schedule; there is no data and no credential claim."
    },
    {
      "n": 3,
      "course": "AP Biology",
      "unit": "Cell Structure and Transport",
      "stem": "A cell moves ions from a region of low concentration outside to high concentration inside, and the process stops when ATP synthesis is inhibited. This is best described as",
      "options": [
        "simple diffusion",
        "facilitated diffusion through a channel",
        "active transport by a membrane pump",
        "osmosis of water"
      ],
      "answer": "C",
      "why": "Movement against the gradient that requires ATP is active transport; diffusion and osmosis are passive and would run down the gradient without energy."
    },
    {
      "n": 4,
      "course": "AP English Language",
      "unit": "Tone",
      "stem": "The report calls the delay \"temporary,\" a word doing heroic work in a document that has been \"temporary\" since 2019. The tone is best described as",
      "options": [
        "neutral and objective",
        "wry and skeptical",
        "celebratory",
        "apologetic"
      ],
      "answer": "B",
      "why": "\"Doing heroic work\" ironizes the official word; the writer is doubting the label, not reporting it straight."
    },
    {
      "n": 5,
      "course": "AP Biology",
      "unit": "Cell Structure and Transport",
      "stem": "A plant cell with a water potential of -0.9 MPa is placed in a solution with a water potential of -0.3 MPa. Water will",
      "options": [
        "move into the cell",
        "move out of the cell",
        "show no net movement",
        "move only if ATP is supplied"
      ],
      "answer": "A",
      "why": "Water moves from higher water potential (-0.3 MPa) toward lower (-0.9 MPa), which is into the cell. Water potential movement is passive."
    },
    {
      "n": 6,
      "course": "AP English Language",
      "unit": "Syntax",
      "stem": "\"The town raised the levy, rebuilt the bridge, hired the teachers, and called the year a success.\" The effect of the compound series is to",
      "options": [
        "create urgency through short fragments",
        "build momentum by stacking parallel actions into one sweep",
        "undermine the claim with qualification",
        "shift the passage from past to future tense"
      ],
      "answer": "B",
      "why": "Parallel clauses accumulate without interruption, producing speed and a sense of a single collective effort."
    },
    {
      "n": 7,
      "course": "AP Biology",
      "unit": "Photosynthesis",
      "stem": "A plant is supplied with H2-18O. The 18O label will first appear in",
      "options": [
        "glucose produced in the Calvin cycle",
        "O2 released during the light reactions",
        "CO2 released by the plant",
        "the water absorbed by the roots"
      ],
      "answer": "B",
      "why": "Photosystem II splits water, and the oxygen released comes from water, not from CO2. The label therefore exits as 18O2."
    },
    {
      "n": 8,
      "course": "AP English Language",
      "unit": "Diction",
      "stem": "A writer describes the mayor's staff as \"the new regime at city hall\" rather than \"the new administration.\" The choice of \"regime\" primarily",
      "options": [
        "neutralizes the subject",
        "implies illegitimacy or heavy-handed control",
        "adds statistical precision",
        "softens the criticism"
      ],
      "answer": "B",
      "why": "\"Regime\" carries a connotation of unelected or coercive rule that \"administration\" does not."
    },
    {
      "n": 9,
      "course": "AP Biology",
      "unit": "Cellular Respiration",
      "stem": "In aerobic respiration, carbon dioxide is produced directly during",
      "options": [
        "glycolysis only",
        "pyruvate oxidation and the Krebs cycle",
        "the electron transport chain",
        "chemiosmosis at ATP synthase"
      ],
      "answer": "B",
      "why": "Decarboxylation of pyruvate and the Krebs cycle reactions release CO2; the ETC and chemiosmosis move electrons and protons, not carbon."
    },
    {
      "n": 10,
      "course": "AP English Language",
      "unit": "Rhetorical analysis",
      "stem": "\"The shelter sits across the street from the courthouse, so that the people it serves are never out of sight of the institution that processes them.\" The juxtaposition primarily",
      "options": [
        "highlights the proximity of care and consequence",
        "supplies a neutral geographic fact",
        "introduces a counterargument",
        "establishes the author's credentials"
      ],
      "answer": "A",
      "why": "The paired institutions are placed side by side to make a point about who is helped and who is processed; the geography is doing argumentative work."
    },
    {
      "n": 11,
      "course": "AP Biology",
      "unit": "Enzymes",
      "stem": "A noncompetitive inhibitor binds an enzyme away from the active site. The expected effect on kinetics is",
      "options": [
        "Vmax unchanged, Km increased",
        "Vmax decreased, Km unchanged",
        "Vmax increased, Km decreased",
        "both Vmax and Km unchanged"
      ],
      "answer": "B",
      "why": "Noncompetitive inhibition removes functional enzyme, lowering Vmax, while remaining active sites still bind substrate with the same affinity, so Km is unchanged."
    },
    {
      "n": 12,
      "course": "AP English Language",
      "unit": "Argument",
      "stem": "Which sentence is the strongest thesis for an argument essay on later school start times?",
      "options": [
        "Many schools start early.",
        "Later start times improve adolescent attendance and grades, and districts can pay for the change by restructuring bus routes rather than cutting programs.",
        "Sleep is important, and teenagers are tired.",
        "Some say later start times are bad, while others say they are good."
      ],
      "answer": "B",
      "why": "It takes a defensible position and names a mechanism for both the benefit and the objection; the others are observations or a non-committal summary."
    },
    {
      "n": 13,
      "course": "AP Biology",
      "unit": "Cell Cycle",
      "stem": "A cell with damaged DNA is halted at the G2 checkpoint and never enters mitosis. The most direct explanation is that",
      "options": [
        "cyclin-Cdk activity required for M phase entry is not activated",
        "DNA polymerase fails to proofread during S phase",
        "spindle fibers fail to attach to kinetochores",
        "chromosomes fail to condense during prophase"
      ],
      "answer": "A",
      "why": "The G2 checkpoint blocks activation of the cyclin-Cdk complexes that drive entry into mitosis; spindle attachment is checked later, in M phase."
    },
    {
      "n": 14,
      "course": "AP English Language",
      "unit": "Argument",
      "stem": "\"Opponents argue the plan costs too much. They are right about the price tag — and still wrong about whether it is worth paying.\" This move",
      "options": [
        "concedes a point in order to sharpen the rebuttal",
        "abandons the original claim",
        "relies on a personal attack",
        "offers no reasoning at all"
      ],
      "answer": "A",
      "why": "Granting the cost objection first makes the writer look fair and lets the real disagreement — value, not price — carry the paragraph."
    },
    {
      "n": 15,
      "course": "AP Biology",
      "unit": "Meiosis and Heredity",
      "stem": "Nondisjunction occurs in meiosis I of a single cell. The resulting four gametes will be",
      "options": [
        "all haploid and normal",
        "two with an extra chromosome and two missing one",
        "all tetraploid",
        "two diploid and two haploid"
      ],
      "answer": "B",
      "why": "Homologs fail to separate, so one pole gets both homologs and the other gets neither; after meiosis II that yields two n+1 and two n-1 gametes."
    },
    {
      "n": 16,
      "course": "AP English Language",
      "unit": "Synthesis",
      "stem": "In a synthesis essay, the most effective way to use a source is to",
      "options": [
        "quote it at length and agree with it",
        "attribute it and explain how its evidence supports or limits your claim",
        "leave out sources that disagree",
        "list every source in the introduction"
      ],
      "answer": "B",
      "why": "Synthesis is graded on how sources are woven into an argument; attributing plus analyzing is the move that earns the point."
    },
    {
      "n": 17,
      "course": "AP Biology",
      "unit": "Heredity",
      "stem": "A cross of AaBb x aabb produces offspring in a 1:1:1:1 ratio. If the two genes were tightly linked, the expected result would instead be",
      "options": [
        "still 1:1:1:1",
        "mostly parental combinations, with few recombinants",
        "a 9:3:3:1 ratio",
        "only parental combinations and no other classes"
      ],
      "answer": "B",
      "why": "Linkage suppresses independent assortment, so parental allele combinations predominate; some recombinants still appear through crossing over."
    },
    {
      "n": 18,
      "course": "AP English Language",
      "unit": "Style devices",
      "stem": "\"We waited. We waited through the hearing, we waited through the appeal, and we are still waiting.\" The dominant device and its effect are",
      "options": [
        "anaphora, reinforcing persistence and rising impatience",
        "hyperbole, exaggerating for comic effect",
        "understatement, minimizing the delay",
        "apostrophe, addressing an absent person"
      ],
      "answer": "A",
      "why": "The repeated opening \"we waited\" is anaphora; the repetition makes the delay feel cumulative rather than merely reported."
    },
    {
      "n": 19,
      "course": "AP Biology",
      "unit": "Gene Expression",
      "stem": "A mutation in a gene's promoter prevents RNA polymerase from binding. The most likely result is",
      "options": [
        "transcription of that gene decreases",
        "translation decreases while transcription stays normal",
        "the protein folds incorrectly",
        "DNA replication of that chromosome stops"
      ],
      "answer": "A",
      "why": "Promoter binding is the step RNA polymerase performs to start transcription; blocking it reduces mRNA and therefore the protein downstream."
    },
    {
      "n": 20,
      "course": "AP English Language",
      "unit": "Rhetorical analysis",
      "stem": "\"The district's response to a four-year delay was, to put it gently, unhurried.\" The understatement functions to",
      "options": [
        "express genuine approval",
        "deliver criticism through ironic restraint",
        "supply factual neutrality",
        "introduce statistical evidence"
      ],
      "answer": "B",
      "why": "\"To put it gently\" signals the speaker is holding back; the mild word \"unhurried\" lands harder than an outright accusation."
    },
    {
      "n": 21,
      "course": "AP Biology",
      "unit": "Cell Communication",
      "stem": "A single hormone molecule binding to one receptor leads to thousands of activated enzyme molecules inside the cell. This property of the pathway is called",
      "options": [
        "amplification",
        "specificity",
        "desensitization",
        "negative feedback"
      ],
      "answer": "A",
      "why": "Each step in a kinase cascade activates many downstream molecules, so one signal becomes a large response — signal amplification."
    },
    {
      "n": 22,
      "course": "AP English Language",
      "unit": "Evidence",
      "stem": "Which evidence most directly supports the claim that a city's recycling program lost money?",
      "options": [
        "A neighbour's opinion that recycling is wasteful",
        "The program's audited annual budget showing costs exceeded revenue",
        "A survey showing recycling is popular",
        "An article about recycling in a different city"
      ],
      "answer": "B",
      "why": "The claim is financial, so the relevant evidence is the program's own audited costs against revenue; popularity and other cities answer different questions."
    },
    {
      "n": 23,
      "course": "AP Biology",
      "unit": "Evolution",
      "stem": "In a population at Hardy-Weinberg equilibrium, 16% of individuals show the recessive phenotype. The expected frequency of heterozygotes is",
      "options": [
        "0.16",
        "0.24",
        "0.36",
        "0.48"
      ],
      "answer": "D",
      "why": "q squared = 0.16 so q = 0.4 and p = 0.6; heterozygotes are 2pq = 2(0.6)(0.4) = 0.48."
    },
    {
      "n": 24,
      "course": "AP English Language",
      "unit": "Line of reasoning",
      "stem": "\"Our school adopted uniforms in 2019. Test scores rose in 2020. Therefore uniforms caused the score increase.\" The reasoning is weak mainly because",
      "options": [
        "it relies on too many statistics",
        "it treats correlation as causation without ruling out other causes",
        "uniforms were never actually adopted",
        "the conclusion contradicts the evidence"
      ],
      "answer": "B",
      "why": "A rise after a change is not proof of the change; the argument never excludes other explanations such as new curricula or a different test."
    },
    {
      "n": 25,
      "course": "AP Biology",
      "unit": "Natural Selection",
      "stem": "After several years of antibiotic use, the proportion of resistant bacteria in a population rises sharply. The best explanation is",
      "options": [
        "bacteria mutate in direct response to the antibiotic",
        "variants that were already resistant survive and reproduce more",
        "the antibiotic teaches bacteria to resist it",
        "all bacteria become resistant at the same rate"
      ],
      "answer": "B",
      "why": "Selection acts on existing variation: the antibiotic kills susceptible cells, leaving resistant ones to reproduce. Mutation is not directed by the drug."
    },
    {
      "n": 26,
      "course": "AP English Language",
      "unit": "Purpose",
      "stem": "\"This letter does not ask the board to reverse its decision. It asks the board to explain it.\" The main purpose of the letter is to",
      "options": [
        "request a reversal of the decision",
        "demand transparency and accountability rather than a different outcome",
        "praise the board's judgment",
        "announce an impending lawsuit"
      ],
      "answer": "B",
      "why": "The sentence explicitly declines the reversal and names a narrower demand — an explanation — which is the letter's aim."
    },
    {
      "n": 27,
      "course": "AP Biology",
      "unit": "Ecology",
      "stem": "Producers in an ecosystem fix 10,000 kcal of energy. Assuming roughly 10% transfer between trophic levels, the energy available to tertiary consumers is about",
      "options": [
        "1,000 kcal",
        "100 kcal",
        "10 kcal",
        "1 kcal"
      ],
      "answer": "C",
      "why": "10,000 to primary (1,000) to secondary (100) to tertiary (10) — three transfers of 10%."
    },
    {
      "n": 28,
      "course": "AP English Language",
      "unit": "Tone",
      "stem": "\"For years the park was the neighbourhood's front porch. Then the fencing went up, the benches came out, and the front porch became a parking lot.\" The tone shifts from",
      "options": [
        "anger to acceptance",
        "affection to loss",
        "humour to formality",
        "neutrality to praise"
      ],
      "answer": "B",
      "why": "\"Front porch\" carries warmth; the fencing, removed benches and parking lot reverse it into something lost."
    },
    {
      "n": 29,
      "course": "AP Biology",
      "unit": "Ecology",
      "stem": "A population growing logistically approaches its carrying capacity. At that point the per-capita growth rate is closest to",
      "options": [
        "its maximum",
        "zero",
        "strongly negative",
        "exponential growth"
      ],
      "answer": "B",
      "why": "As N approaches K the term (K-N)/K approaches zero, so births and deaths balance and growth stops."
    },
    {
      "n": 30,
      "course": "AP English Language",
      "unit": "Rhetorical analysis",
      "stem": "\"The proposal is expensive, underfunded, and overdue — and it is still the only one on the table.\" The writer's structure primarily serves to",
      "options": [
        "list objections in order to dismiss the proposal",
        "concede the flaws before insisting on the proposal's necessity",
        "avoid taking any position",
        "appeal only to the reader's emotions"
      ],
      "answer": "B",
      "why": "The dash turns accumulated objections into a pivot: the flaws are granted so the necessity argument can carry the sentence."
    },
    {
      "n": 31,
      "course": "AP Biology",
      "unit": "Experimental Design",
      "stem": "A student tests whether light intensity affects plant growth. Which condition is the control?",
      "options": [
        "Plants exposed to several different light intensities",
        "Plants grown under standard, unaltered light conditions",
        "Plants measured every day",
        "Plants grown in different soils"
      ],
      "answer": "B",
      "why": "The control holds the independent variable at a baseline so growth can be compared against it; varying light is the treatment, not the control."
    },
    {
      "n": 32,
      "course": "AP English Language",
      "unit": "Argument",
      "stem": "The most effective conclusion to an argument essay",
      "options": [
        "introduces a new argument not mentioned earlier",
        "restates the thesis in light of the evidence and states the implication or call to action",
        "apologizes for the essay's limitations",
        "repeats the introduction word for word"
      ],
      "answer": "B",
      "why": "A conclusion earns its keep by closing the loop the evidence opened; new arguments or a verbatim repeat waste the final paragraph."
    },
    {
      "n": 33,
      "course": "AP Biology",
      "unit": "Cell Structure",
      "stem": "Mitochondria and chloroplasts each contain circular DNA and 70S ribosomes. This observation is best explained by",
      "options": [
        "an endosymbiotic origin from free-living prokaryotes",
        "de novo synthesis inside the nucleus",
        "direct inheritance from the Golgi apparatus",
        "random mutation of eukaryotic DNA"
      ],
      "answer": "A",
      "why": "Circular DNA plus prokaryote-style ribosomes and double membranes are the classic endosymbiosis evidence, not a feature of nuclear or Golgi origin."
    }
  ]
};
