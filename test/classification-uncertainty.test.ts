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
