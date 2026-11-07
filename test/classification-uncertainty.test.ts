process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCalibratedRelevance,
  extractCalibratedPerspective,
  evaluateEvidenceSufficiency,
  evaluateThailandConnection,
  evaluateTopicalRelevance,
  isKnownPlaceholder
} from "../lib/classification/calibrated-classifier";
import { runBenchmarkEvaluation } from "../lib/classification/benchmark-evaluator";
import { parseAndValidateGeminiResponse } from "../lib/classifiers";
import { saveSources } from "../lib/ingest/save";
import { prisma } from "../lib/prisma";
import { publicSourceRecordWhere, publicPerspectiveWhere } from "../lib/public-projection";

test("isKnownPlaceholder detects OpenAlex and generic placeholders", () => {
  assert.equal(isKnownPlaceholder("Academic paper about thailand robot indexed on OpenAlex."), true);
  assert.equal(isKnownPlaceholder("OpenAlex abstract metadata available."), true);
  assert.equal(isKnownPlaceholder("placeholder"), true);
  assert.equal(isKnownPlaceholder("Dinsaw Robot is an artificial intelligence service robot."), false);
});

test("evaluateEvidenceSufficiency classifies placeholder, title-only, and thin text", () => {
  assert.equal(
    evaluateEvidenceSufficiency("Title", "Academic paper about robotics indexed on OpenAlex."),
    "insufficient_placeholder"
  );
  assert.equal(evaluateEvidenceSufficiency("Title", ""), "insufficient_title_only");
  assert.equal(evaluateEvidenceSufficiency("Title", "   "), "insufficient_title_only");
  assert.equal(evaluateEvidenceSufficiency("Title", "Short text"), "insufficient_thin");
  assert.equal(
    evaluateEvidenceSufficiency(
      "Dinsaw Robot Deployment",
      "Dinsaw Robot was deployed at Chulalongkorn Hospital to assist elderly patients with medication."
    ),
    "sufficient"
  );
});

test("evaluates Thailand connection with institutional and geographic tokens, separating language from location", () => {
  const chula = evaluateThailandConnection("Research at Chulalongkorn University in Bangkok");
  assert.equal(chula.hasConnection, true);

  const siriraj = evaluateThailandConnection("Medical staff at Siriraj Hospital deployed service robots");
  assert.equal(siriraj.hasConnection, true);

  const thaiWithInst = evaluateThailandConnection("ทีมวิจัยจุฬาลงกรณ์พัฒนาหุ่นยนต์เพื่อสังคมในกรุงเทพ");
  assert.equal(thaiWithInst.hasConnection, true);

  // Pure Thai script without geographic or institutional token alone does NOT grant connection
  const genericThai = evaluateThailandConnection("ทีมวิจัยพัฒนาหุ่นยนต์เพื่อสังคม");
  assert.equal(genericThai.hasConnection, false);
  assert.ok(genericThai.matchedTerms.includes("thai_script"));

  // Translated foreign robot described in Thai script (France) must reject Thailand connection
  const foreignInThai = evaluateThailandConnection("หุ่นยนต์ฮิวแมนนอยด์รุ่นใหม่ที่พัฒนาและทดสอบในกรุงปารีส ประเทศฝรั่งเศส");
  assert.equal(foreignInThai.hasConnection, false);

  const usa = evaluateThailandConnection("Boston Dynamics Atlas robot in Massachusetts laboratory");
  assert.equal(usa.hasConnection, false);

  const padThai = evaluateThailandConnection("Authentic Pad Thai cooking recipes with peanuts");
  assert.equal(padThai.hasConnection, false);
});

test("evaluates topical relevance: distinguishes embodied robots from software and eldercare", () => {
  const software = evaluateTopicalRelevance("Android mobile app development for Bangkok bus transit");
  assert.equal(software.topicalRelevance, "software_only");

  const eldercare = evaluateTopicalRelevance("Nutritional intake and eldercare nursing protocols in Chiang Mai");
  assert.equal(eldercare.topicalRelevance, "non_robot_care");

  const humanoid = evaluateTopicalRelevance("Dynamic balance of bipedal humanoid robot FIBO KMUTT");
  assert.equal(humanoid.topicalRelevance, "embodied_robot");

  const service = evaluateTopicalRelevance("Autonomous service robots navigate corridors in hospital");
  assert.equal(service.topicalRelevance, "embodied_robot");
});

test("Audit D05 trap: rejects software-only Android app in Thailand without auto-publishing", () => {
  const result = classifyCalibratedRelevance(
    "Building an Android mobile application for Bangkok public transit bus ticketing",
    "Tutorial explaining how to develop a native Android smartphone app using Kotlin in Bangkok, Thailand."
  );
  assert.equal(result.relevanceStatus, "REJECTED");
  assert.equal(result.autoPublishEligible, false);
  assert.equal(result.requiresHumanReview, false);
  assert.ok(result.calibratedConfidence >= 0.80);
});

test("Audit D05 trap: rejects non-robot eldercare in Thailand", () => {
  const result = classifyCalibratedRelevance(
    "Nutritional intake and eldercare nursing protocols in Chiang Mai senior facilities",
    "Study surveying dietary needs, physical therapy routines, and caregiver staffing ratios across residential eldercare homes in Chiang Mai, Thailand."
  );
  assert.equal(result.relevanceStatus, "REJECTED");
  assert.equal(result.autoPublishEligible, false);
  assert.equal(result.requiresHumanReview, false);
});

test("Audit D05 trap: rejects substring food and sport traps", () => {
  const padThai = classifyCalibratedRelevance(
    "Authentic Pad Thai cooking recipes and street food market guide in Bangkok",
    "Discover how to cook traditional Pad Thai noodles with tamarind pulp, tofu, and crushed peanuts across Bangkok."
  );
  assert.equal(padThai.relevanceStatus, "REJECTED");
  assert.equal(padThai.autoPublishEligible, false);

  const muayThai = classifyCalibratedRelevance(
    "Muay Thai martial arts training camps and fitness programs in Phuket",
    "An overview of intensive Muay Thai kickboxing gyms, conditioning regimens, and sparring facilities in Phuket, Thailand."
  );
  assert.equal(muayThai.relevanceStatus, "REJECTED");
  assert.equal(muayThai.autoPublishEligible, false);
});

test("Audit D05 trap: OpenAlex placeholder is flagged UNCERTAIN with human review required", () => {
  const result = classifyCalibratedRelevance(
    "Humanoid robotics control architectures and perception systems for hospital care",
    "Academic paper about thailand robot indexed on OpenAlex."
  );
  assert.equal(result.relevanceStatus, "UNCERTAIN");
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.autoPublishEligible, false);
  assert.ok(result.calibratedConfidence < 0.50);
});

test("Audit D05 trap: title-only entry is flagged UNCERTAIN with human review required", () => {
  const result = classifyCalibratedRelevance(
    "Autonomous telepresence robot trials at Chulalongkorn Memorial Hospital Bangkok",
    ""
  );
  assert.equal(result.relevanceStatus, "UNCERTAIN");
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.autoPublishEligible, false);
});

test("Audit D05 stance: privacy telemetry research is not misclassified as skeptical/negative", () => {
  const result = extractCalibratedPerspective(
    "Privacy-preserving telemetry and encrypted perception for hospital eldercare robots",
    "We present a secure edge architecture for Dinsaw eldercare robots deployed in Bangkok hospitals, ensuring patient privacy while improving monitoring reliability."
  );
  assert.equal(result.perspectiveTheme, "privacy_and_surveillance");
  assert.equal(result.stance, "supportive");
  assert.equal(result.sentiment, "positive");
  assert.equal(result.requiresHumanReview, false);
});

test("Audit D05 stance: Thai PDPA data protection for robots is classified as supportive/positive", () => {
  const result = extractCalibratedPerspective(
    "การออกแบบสถาปัตยกรรมความปลอดภัยและปกป้องข้อมูลส่วนบุคคลสำหรับหุ่นยนต์บริการดินสอในโรงพยาบาลไทย",
    "ทีมวิจัยนำเสนอระบบเข้ารหัสข้อมูลและปกป้องข้อมูลส่วนบุคคลตาม พ.ร.บ. PDPA สำหรับหุ่นยนต์ดินสอในโรงพยาบาล ช่วยยกระดับความปลอดภัยและความไว้วางใจของผู้ป่วย"
  );
  assert.equal(result.perspectiveTheme, "privacy_and_surveillance");
  assert.equal(result.stance, "supportive");
  assert.equal(result.sentiment, "positive");
});

test("Audit D05 stance: genuine labor concern is classified as skeptical/negative", () => {
  const result = extractCalibratedPerspective(
    "Hotel labor unions raise alarm over service humanoid robots replacing workers in Pattaya",
    "Hospitality labor unions in Thailand express strong fear and protest against hotel chains deploying humanoid greeting robots, warning of widespread job loss and wage cuts."
  );
  assert.equal(result.perspectiveTheme, "job_displacement");
  assert.equal(result.stance, "skeptical");
  assert.equal(result.sentiment, "negative");
});

test("accepts authentic Thai humanoid and service robotics with auto-publish eligibility", () => {
  const dinsaw = classifyCalibratedRelevance(
    "Home - English - Dinsaw Robot",
    "Dinsaw Robot is an artificial intelligence or AI that can listen and respond to gestures or spoken words, developed by CT Asia Robotics in Thailand."
  );
  assert.equal(dinsaw.relevanceStatus, "ACCEPTED");
  assert.equal(dinsaw.autoPublishEligible, true);
  assert.equal(dinsaw.requiresHumanReview, false);
  assert.ok(dinsaw.calibratedConfidence >= 0.80);

  const curobo = classifyCalibratedRelevance(
    "จุฬาลงกรณ์มหาวิทยาลัย เปิดตัวหุ่นยนต์ช่วยบุคลากรทางการแพทย์ CU-Robo ในโรงพยาบาล",
    "คณะวิศวกรรมศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย พัฒนาหุ่นยนต์บริการ CU-Robo เพื่อช่วยลำเลียงยาและติดต่อสื่อสารทางไกลแบบ Telepresence ให้บุคลากรทางการแพทย์ในหอผู้ป่วย"
  );
  assert.equal(curobo.relevanceStatus, "ACCEPTED");
  assert.equal(curobo.autoPublishEligible, true);
});

test("rejects out-of-scope foreign robot and heavy industrial arm", () => {
  const atlas = classifyCalibratedRelevance(
    "Boston Dynamics Atlas humanoid robot performs backflip in Boston laboratory",
    "The Atlas humanoid research platform demonstrates advanced bipedal parkour and dynamic balance control in Massachusetts, United States."
  );
  assert.equal(atlas.relevanceStatus, "REJECTED");
  assert.equal(atlas.autoPublishEligible, false);

  const industrial = classifyCalibratedRelevance(
    "Heavy industrial spot welding robotic arm installation in Rayong car assembly plant",
    "An automotive manufacturer completed integration of automated industrial articulated welding arms on the chassis assembly line in Rayong industrial estate, Thailand."
  );
  assert.equal(industrial.relevanceStatus, "REJECTED");
  assert.equal(industrial.autoPublishEligible, false);
});

test("Audit D05 trap: contradictory software and robot signals are flagged UNCERTAIN", () => {
  const result = classifyCalibratedRelevance(
    "Developing an Android companion mobile app for controlling humanoid service robots in Bangkok",
    "This tutorial guides developers through creating an Android smartphone APK with Bluetooth interface to remotely operate a Dinsaw humanoid service robot at a Bangkok clinic."
  );
  assert.equal(result.relevanceStatus, "UNCERTAIN");
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.autoPublishEligible, false);
  assert.equal(result.calibratedConfidence, 0.65);
});

test("Audit D05 language separation: Thai-language description of foreign robot in France is REJECTED", () => {
  const result = classifyCalibratedRelevance(
    "เปิดตัวหุ่นยนต์ฮิวแมนนอยด์รุ่นใหม่ล่าสุดในกรุงปารีส ประเทศฝรั่งเศส",
    "วิศวกรชาวฝรั่งเศสสาธิตหุ่นยนต์ฮิวแมนนอยด์สองขาที่สามารถเดินและทรงตัวได้อย่างยอดเยี่ยมในห้องทดลอง ณ กรุงปารีส ประเทศฝรั่งเศส"
  );
  assert.equal(result.relevanceStatus, "REJECTED");
  assert.equal(result.requiresHumanReview, false);
  assert.equal(result.autoPublishEligible, false);
});

test("runBenchmarkEvaluation runs on full benchmark and validates all acceptance criteria", () => {
  const report = runBenchmarkEvaluation();
  assert.equal(report.totalCases, 32);
  assert.equal(report.summary.calibrated.syntheticTrapsFalsePositives, 0);
  assert.equal(report.summary.calibrated.insufficientEvidenceCorrectlyUncertainCount, 5);
  assert.equal(report.summary.calibrated.autoPublishFalsePositivesCount, 0);
  assert.equal(report.summary.calibrated.privacyStanceCorrectCount, 2);
  assert.ok(report.summary.calibrated.relevanceAccuracy >= 0.90);
});

test("parseAndValidateGeminiResponse enforces strict triplet validation and filters invalid or missing confidence", () => {
  const rawResponse = JSON.stringify({
    isRelevant: true,
    relevanceReason: "Hospital service robot deployment in Bangkok",
    relevanceConfidence: 0.95,
    theme: "healthcare_and_eldercare_trust",
    stance: "supportive",
    sentiment: "positive",
    targetEntity: "Dinsaw Robot",
    evidenceExcerpt: "Dinsaw robot assists medical team at hospital in Bangkok.",
    confidence: 0.92,
    triplets: [
      // Valid high-confidence triplet
      { subject: "Dinsaw Robot", relation: "deployed_at", object: "Hospital", confidence: 0.95 },
      // Valid mid-confidence triplet (retained by validator, gated by saveSources)
      { subject: "Medical staff", relation: "operates", object: "Dinsaw Robot", confidence: 0.75 },
      // Missing confidence: must be dropped by parser
      { subject: "Dinsaw Robot", relation: "assists", object: "Patients" },
      // Null confidence: must be dropped
      { subject: "Dinsaw Robot", relation: "monitors", object: "Vitals", confidence: null },
      // NaN confidence: must be dropped
      { subject: "Dinsaw Robot", relation: "records", object: "Data", confidence: NaN },
      // Out-of-range confidence (> 1.0): must be dropped
      { subject: "Dinsaw Robot", relation: "delivers", object: "Medicine", confidence: 1.5 },
      // Out-of-range confidence (< 0.0): must be dropped
      { subject: "Dinsaw Robot", relation: "navigates", object: "Corridor", confidence: -0.2 },
      // Empty entity text: must be dropped
      { subject: "  ", relation: "cleans", object: "Room", confidence: 0.9 }
    ]
  });

  const parsed = parseAndValidateGeminiResponse(rawResponse);
  assert.equal(parsed.isRelevant, true);
  assert.equal(parsed.triplets.length, 2, "Only triplets with valid non-null [0, 1] confidence and non-empty text survive");
  assert.equal(parsed.triplets[0].subject, "Dinsaw Robot");
  assert.equal(parsed.triplets[0].confidence, 0.95);
  assert.equal(parsed.triplets[1].subject, "Medical staff");
  assert.equal(parsed.triplets[1].confidence, 0.75);
});

test("saveSources re-ingestion cleanup preserves curated seed annotations and seed triplets", async () => {
  const deletedAnnotationWheres: any[] = [];
  const deletedTripletWheres: any[] = [];
  const upsertedAnnotations: any[] = [];

  const originalTransaction = prisma.$transaction;

  try {
    (prisma as any).$transaction = async (callback: any) => {
      let stored: any;
      const txMock = {
        $queryRaw: async () => [],
        sourceRecord: {
          findUnique: async () => null,
          findUniqueOrThrow: async () => ({ ...stored, annotations: [], triplets: [] }),
          update: async () => ({}),
          upsert: async (args: any) => (stored = { ...args.create, createdAt: new Date(), updatedAt: new Date(),
            id: "src-seed-001",
            sourceType: args.create.sourceType,
            rawMeta: args.create.rawMeta
          })
        },
        perspectiveAnnotation: {
          deleteMany: async (args: any) => {
            deletedAnnotationWheres.push(args.where);
            return { count: 0 };
          },
          upsert: async (args: any) => {
            upsertedAnnotations.push(args);
            return args.create;
          }
        },
        triplet: {
          deleteMany: async (args: any) => {
            deletedTripletWheres.push(args.where);
            return { count: 0 };
          },
          upsert: async (args: any) => args.create
        }
      };
      return callback(txMock);
    };

    // Re-ingest a curated SEED record
    await saveSources([
      {
        sourceType: "SEED",
        title: "Home - English - Dinsaw Robot",
        url: "https://www.dinsaw.com/en/home-english/",
        excerpt: "Dinsaw Robot is an artificial intelligence or AI developed by CT Asia Robotics in Thailand.",
        publishedAt: new Date("2024-01-01"),
        rawMeta: { source_id: "seed-dinsaw-01", category: "triplet_relation", networkGeo: { geo: { latitude: 1, longitude: 1 } } }
      }
    ]);

    // Verify:
    // 1. tx.perspectiveAnnotation.deleteMany strictly targets MACHINE_ANNOTATION_METHODS
    //    and does NOT target "human_review" or "seed_json"
    assert.equal(deletedAnnotationWheres.length, 1);
    const deleteWhere = deletedAnnotationWheres[0];
    assert.deepEqual(deleteWhere.method, { in: ["gemini-1.5-flash", "rules_fallback", "rules_with_evidence"] });
    assert.ok(!deleteWhere.method.in.includes("human_review"));
    assert.ok(!deleteWhere.method.in.includes("seed_json"));

    // 2. tx.triplet.deleteMany is NEVER called for curated seed sources
    assert.equal(deletedTripletWheres.length, 0, "Curated seed triplets must never be wiped out on re-ingestion");
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test("re-ingestion of uncertain/placeholder records suppresses auto-publication and prevents public projection leakage", async () => {
  const upsertedAnnotations: any[] = [];
  const originalTransaction = prisma.$transaction;

  try {
    (prisma as any).$transaction = async (callback: any) => {
      let stored: any;
      const txMock = {
        $queryRaw: async () => [],
        sourceRecord: {
          findUnique: async () => null,
          findUniqueOrThrow: async () => ({ ...stored, annotations: [], triplets: [] }),
          update: async () => ({}),
          upsert: async (args: any) => (stored = { ...args.create, createdAt: new Date(), updatedAt: new Date(),
            id: "src-uncertain-001",
            sourceType: args.create.sourceType,
            rawMeta: args.create.rawMeta,
            relevanceStatus: args.create.relevanceStatus
          })
        },
        perspectiveAnnotation: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async (args: any) => {
            upsertedAnnotations.push(args);
            return args.create;
          }
        },
        triplet: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async (args: any) => args.create
        }
      };
      return callback(txMock);
    };

    // Ingest an OpenAlex placeholder record
    await saveSources([
      {
        sourceType: "OPENALEX",
        title: "Humanoid robotics control architectures and perception systems for hospital care",
        url: "https://openalex.org/W999999999",
        excerpt: "Academic paper about thailand robot indexed on OpenAlex.",
        publishedAt: new Date("2024-01-01"),
        rawMeta: { networkGeo: { geo: { latitude: 1, longitude: 1 } } }
      }
    ]);

    // Verify that NO perspective annotation was created or auto-published
    assert.equal(upsertedAnnotations.length, 0, "Uncertain records must not auto-publish perspective annotations");

    // Verify public query filters:
    // Both publicSourceRecordWhere and publicPerspectiveWhere demand relevanceStatus === 'ACCEPTED'
    assert.equal(publicSourceRecordWhere.relevanceStatus, "ACCEPTED");
    assert.equal(publicPerspectiveWhere.source.relevanceStatus, "ACCEPTED");

    // The uncertain status would be blocked at query time
    assert.notEqual("UNCERTAIN", publicSourceRecordWhere.relevanceStatus);
    assert.notEqual("REJECTED", publicSourceRecordWhere.relevanceStatus);
  } finally {
    prisma.$transaction = originalTransaction;
  }
});
