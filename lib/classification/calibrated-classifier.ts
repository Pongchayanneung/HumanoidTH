/**
 * Calibrated Bilingual Classifier & Evidence Uncertainty System (Audit D05)
 * 
 * Assesses:
 * 1. Evidence sufficiency (detects OpenAlex and empty placeholders, title-only records, thin excerpts)
 * 2. Topical relevance (disambiguates embodied humanoid/service robots from software Android apps & non-robot eldercare)
 * 3. Thailand connection (validates Thai institutions, locations, and script with word boundary guards)
 * 4. Stance & sentiment calibration (disentangles privacy/security themes from negative sentiment)
 * 5. Operating policy & review gate (gating auto-publication when confidence < 0.80 or evidence is insufficient)
 */

export type RelevanceStatus = "ACCEPTED" | "REJECTED" | "UNCERTAIN";

export type EvidenceSufficiency = 
  | "sufficient"
  | "insufficient_placeholder"
  | "insufficient_title_only"
  | "insufficient_thin";

export type TopicalRelevance =
  | "embodied_robot"
  | "software_only"
  | "non_robot_care"
  | "generic_ai"
  | "unrelated"
  | "insufficient_evidence";

export interface CalibratedClassificationResult {
  relevanceStatus: RelevanceStatus;
  relevanceReason: string;
  calibratedConfidence: number;
  factors: {
    evidenceSufficiency: EvidenceSufficiency;
    topicalRelevance: TopicalRelevance;
    thailandConnection: boolean;
    hasContradictorySignals: boolean;
    matchedEmbodiedTerms: string[];
    matchedThailandTerms: string[];
    matchedSoftwareTerms: string[];
  };
  requiresHumanReview: boolean;
  autoPublishEligible: boolean;
  classificationMethod: "calibrated_bilingual_v1";
}

export interface CalibratedPerspectiveResult {
  stance: "supportive" | "skeptical" | "neutral" | "cautious_supportive" | "unclear";
  sentiment: "positive" | "negative" | "neutral" | "mixed" | "unclear";
  perspectiveTheme: string;
  targetEntity: string;
  evidenceExcerpt: string;
  confidence: number;
  method: string;
  requiresHumanReview: boolean;
}

// ---------------------------------------------------------
// Term Lexicons & Patterns
// ---------------------------------------------------------

const KNOWN_PLACEHOLDER_REGEXES = [
  /^academic paper about .* indexed on openalex\.?$/i,
  /^openalex abstract metadata available\.?$/i,
  /^\s*placeholder\s*$/i,
  /^\s*abstract not available\s*$/i,
  /^\s*no abstract provided\s*$/i
];

const SOFTWARE_ONLY_PATTERNS = [
  /\bandroid\s+(?:app|apps|application|applications|os|sdk|studio|phone|smartphone|device|tablet)\b/i,
  /\b(?:mobile app|mobile application|play store|ios and android|jetpack compose|kotlin)\b/i,
  /(?:แอปพลิเคชัน|ระบบปฏิบัติการ\s*android|แอปมือถือ|การพัฒนาแอป)/i
];

const NON_ROBOT_CARE_PATTERNS = [
  /\b(?:nutritional intake|dietary guidelines|caregiver staffing|nursing home management|geriatric nursing)\b/i,
  /(?:การบริบาลผู้สูงอายุ|สถานบริบาลผู้สูงอายุ|การจัดบริการดูแลระยะยาว|อาสาสมัครสาธารณสุข|อสม\.)/i
];

const SUBSTRING_TRAPS = [
  /\bpad\s*thai\b/i,
  /\bthai\s*(?:food|cuisine|recipe|cooking|massage|boxing|restaurant|curry|silk)\b/i,
  /\bmuay\s*thai\b/i,
  /(?:ผัดไทย|มวยไทย|อาหารไทย|นวดไทย)/i
];

const STRONG_EMBODIED_TERMS = [
  /\b(?:humanoid|android robot|bipedal|social robot|service robot|delivery robot|companion robot|hospital robot|telepresence robot|telepresence|autonomous mobile robot|mobile manipulator|quadruped robot)s?\b/i,
  /\b(?:dinsaw|dinsaw mini|pepper robot|nao robot|sensai)\b/i,
  /(?:หุ่นยนต์ดินสอ|หุ่นยนต์ฮิวแมนนอยด์|หุ่นยนต์บริการ|หุ่นยนต์เพื่อสังคม|หุ่นยนต์ต้อนรับ|แขนกลหุ่นยนต์|หุ่นยนต์ฟื้นฟู|หุ่นยนต์ช่วย|หุ่นยนต์ส่งยา|หุ่นยนต์แสนดี)/i
];

const GENERAL_ROBOT_TERMS = [
  /\b(?:robots?|robotics|robotic)\b/i,
  /(?:หุ่นยนต์|แขนกล)/i
];

const INDUSTRIAL_OUT_OF_SCOPE = [
  /\b(?:spot welding|welding robot|car assembly plant|automotive assembly line|factory arm)\b/i
];

const THAI_INSTITUTIONS = [
  /\b(?:chulalongkorn|mahidol|siriraj|ramathibodi|kasetsart|kmutt|fibo|kmitl|chiang mai university|cmu|prince of songkla|psu|nectec|nstda|ct asia robotics|ct asia|dinsaw|dinsaw mini|dusit hotel)\b/i,
  /(?:จุฬาลงกรณ์|จุฬาฯ|มหิดล|ศิริราช|รามาธิบดี|เกษตรศาสตร์|พระจอมเกล้า|สจล|มจธ|เนคเทค|สวทช|กสทช|ซีที เอเชีย|หุ่นยนต์ดินสอ|ดินสอมินิ)/i
];

const THAI_LOCATIONS = [
  /\b(?:thailand|bangkok|chiang mai|pattaya|phuket|nakhon pathom|thonburi|rayong)\b/i,
  /(?:ประเทศไทย|ไทย|กรุงเทพ|กรุงเทพมหานคร|เชียงใหม่|พัทยา|ภูเก็ต|นครปฐม|ธนบุรี|ระยอง)/i
];

// Stance & Sentiment patterns
const POSITIVE_INDICATORS = [
  /\b(?:help|helps|helping|benefit|benefits|beneficial|assist|assists|assisting|improve|improves|improved|secure|security|effective|effectiveness|successful|success|promising|protect|protects|protecting|valuable|safe|safety)\b/i,
  /(?:ช่วย|ดี|ประโยชน์|สำเร็จ|ปลอดภัย|ยกระดับ|ฟื้นฟู|พัฒนา|มั่นใจ|ไว้วางใจ)/i
];

const SKEPTICAL_NEGATIVE_INDICATORS = [
  /\b(?:alarm|concern|concerns|fear|fears|threat|protest|protests|backlash|unreliable|dangerous|danger|unethical|loss|job loss|wage cut|replace workers|replacing workers|replace jobs|vulnerable|harm)\b/i,
  /(?:กังวล|อันตราย|ต่อต้าน|ลดลง|ล้มเหลว|แย่งงาน|ตกงาน|หวาดระแวง|ประท้วง)/i
];

const CAUTIOUS_MIXED_INDICATORS = [
  /\b(?:cautious|cautiously|trade-off|tradeoffs|risk assessment|collision avoidance|evaluation|balance|balancing|navigating crowded)\b/i,
  /(?:ประเมินความเสี่ยง|ชั่งน้ำหนัก|ระมัดระวัง|หลบหลีกสิ่งกีดขวาง)/i
];

// ---------------------------------------------------------
// Helper Evaluators
// ---------------------------------------------------------

export function isKnownPlaceholder(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return KNOWN_PLACEHOLDER_REGEXES.some((regex) => regex.test(text.trim()));
}

export function evaluateEvidenceSufficiency(title: string, excerpt = ""): EvidenceSufficiency {
  const trimmedExcerpt = (excerpt || "").trim();
  if (isKnownPlaceholder(trimmedExcerpt)) {
    return "insufficient_placeholder";
  }
  if (trimmedExcerpt.length === 0) {
    return "insufficient_title_only";
  }
  if (trimmedExcerpt.length < 30 || `${title} ${trimmedExcerpt}`.trim().length < 45) {
    return "insufficient_thin";
  }
  return "sufficient";
}

export function evaluateThailandConnection(text: string): {
  hasConnection: boolean;
  matchedTerms: string[];
} {
  const matchedTerms: string[] = [];

  // Check institutional matches
  for (const regex of THAI_INSTITUTIONS) {
    const match = text.match(regex);
    if (match) {
      matchedTerms.push(match[0]);
    }
  }

  // Check location matches
  for (const regex of THAI_LOCATIONS) {
    const match = text.match(regex);
    if (match) {
      matchedTerms.push(match[0]);
    }
  }

  // Thai Unicode script indicates language (th), but does NOT alone prove Thailand location/institution
  if (/[\u0E00-\u0E7F]/.test(text)) {
    matchedTerms.push("thai_script");
  }

  // Filter out false trigger if "thai" only exists inside food or sport substrings
  const hasFoodOrSport = SUBSTRING_TRAPS.some((regex) => regex.test(text));
  const hasRealGeoOrInst = matchedTerms.some(
    (t) => t !== "thai_script" && t !== "thai" && t !== "ไทย"
  );

  const nonScriptTerms = matchedTerms.filter((t) => t !== "thai_script");

  if (hasFoodOrSport && !hasRealGeoOrInst && nonScriptTerms.length <= 1) {
    return { hasConnection: false, matchedTerms };
  }

  // Must have independently supported geographic, institutional, or organization evidence in Thailand
  const hasConnection = nonScriptTerms.length > 0;

  return {
    hasConnection,
    matchedTerms
  };
}

export function evaluateTopicalRelevance(text: string): {
  topicalRelevance: TopicalRelevance;
  matchedEmbodiedTerms: string[];
  matchedSoftwareTerms: string[];
  isIndustrialOutOfScope: boolean;
} {
  const matchedEmbodiedTerms: string[] = [];
  const matchedSoftwareTerms: string[] = [];

  // Check software terms
  for (const regex of SOFTWARE_ONLY_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      matchedSoftwareTerms.push(match[0]);
    }
  }

  // Check strong embodied terms
  for (const regex of STRONG_EMBODIED_TERMS) {
    const match = text.match(regex);
    if (match) {
      matchedEmbodiedTerms.push(match[0]);
    }
  }

  // Check general robot terms
  const hasGeneralRobot = GENERAL_ROBOT_TERMS.some((regex) => {
    const m = text.match(regex);
    if (m) {
      matchedEmbodiedTerms.push(m[0]);
      return true;
    }
    return false;
  });

  const isIndustrial = INDUSTRIAL_OUT_OF_SCOPE.some((regex) => regex.test(text));
  const hasNonRobotCare = NON_ROBOT_CARE_PATTERNS.some((regex) => regex.test(text));

  // Disambiguation
  if (matchedSoftwareTerms.length > 0 && matchedEmbodiedTerms.length === 0) {
    return {
      topicalRelevance: "software_only",
      matchedEmbodiedTerms,
      matchedSoftwareTerms,
      isIndustrialOutOfScope: false
    };
  }

  if (hasNonRobotCare && matchedEmbodiedTerms.length === 0) {
    return {
      topicalRelevance: "non_robot_care",
      matchedEmbodiedTerms,
      matchedSoftwareTerms,
      isIndustrialOutOfScope: false
    };
  }

  if (isIndustrial) {
    return {
      topicalRelevance: "unrelated",
      matchedEmbodiedTerms,
      matchedSoftwareTerms,
      isIndustrialOutOfScope: true
    };
  }

  if (matchedEmbodiedTerms.length > 0) {
    return {
      topicalRelevance: "embodied_robot",
      matchedEmbodiedTerms,
      matchedSoftwareTerms,
      isIndustrialOutOfScope: false
    };
  }

  return {
    topicalRelevance: "unrelated",
    matchedEmbodiedTerms,
    matchedSoftwareTerms,
    isIndustrialOutOfScope: false
  };
}

// ---------------------------------------------------------
// Main Calibrated Relevance Classifier
// ---------------------------------------------------------

export function classifyCalibratedRelevance(
  title: string,
  excerpt = ""
): CalibratedClassificationResult {
  const fullText = `${title} ${excerpt}`;
  const sufficiency = evaluateEvidenceSufficiency(title, excerpt);
  const thaiEval = evaluateThailandConnection(fullText);
  const topicEval = evaluateTopicalRelevance(fullText);

  const hasContradictorySignals =
    topicEval.matchedSoftwareTerms.length > 0 && topicEval.matchedEmbodiedTerms.length > 0;

  // Case 1: Insufficient evidence (placeholder, title-only, thin text)
  if (sufficiency !== "sufficient") {
    let reason = "Insufficient source evidence; manual human review required.";
    if (sufficiency === "insufficient_placeholder") {
      reason = "Detected placeholder abstract text; requires verified full metadata or abstract.";
    } else if (sufficiency === "insufficient_title_only") {
      reason = "Title-only entry without excerpt or abstract body; manual verification required.";
    } else if (sufficiency === "insufficient_thin") {
      reason = "Thin text below substantive character threshold; manual review required.";
    }

    return {
      relevanceStatus: "UNCERTAIN",
      relevanceReason: reason,
      calibratedConfidence: 0.42,
      factors: {
        evidenceSufficiency: sufficiency,
        topicalRelevance: sufficiency === "insufficient_placeholder" ? "insufficient_evidence" : topicEval.topicalRelevance,
        thailandConnection: thaiEval.hasConnection,
        hasContradictorySignals,
        matchedEmbodiedTerms: topicEval.matchedEmbodiedTerms,
        matchedThailandTerms: thaiEval.matchedTerms,
        matchedSoftwareTerms: topicEval.matchedSoftwareTerms
      },
      requiresHumanReview: true,
      autoPublishEligible: false,
      classificationMethod: "calibrated_bilingual_v1"
    };
  }

  // Case 2: Software-only Android apps or tooling
  if (topicEval.topicalRelevance === "software_only") {
    return {
      relevanceStatus: "REJECTED",
      relevanceReason: "Software-only application, mobile OS, or developer tooling; not embodied robotics.",
      calibratedConfidence: 0.91,
      factors: {
        evidenceSufficiency: sufficiency,
        topicalRelevance: "software_only",
        thailandConnection: thaiEval.hasConnection,
        hasContradictorySignals: false,
        matchedEmbodiedTerms: [],
        matchedThailandTerms: thaiEval.matchedTerms,
        matchedSoftwareTerms: topicEval.matchedSoftwareTerms
      },
      requiresHumanReview: false,
      autoPublishEligible: false,
      classificationMethod: "calibrated_bilingual_v1"
    };
  }

  // Case 3: Non-robot eldercare or nursing
  if (topicEval.topicalRelevance === "non_robot_care") {
    return {
      relevanceStatus: "REJECTED",
      relevanceReason: "Healthcare or eldercare facility administration without robotics or embodied AI.",
      calibratedConfidence: 0.90,
      factors: {
        evidenceSufficiency: sufficiency,
        topicalRelevance: "non_robot_care",
        thailandConnection: thaiEval.hasConnection,
        hasContradictorySignals: false,
        matchedEmbodiedTerms: [],
        matchedThailandTerms: thaiEval.matchedTerms,
        matchedSoftwareTerms: []
      },
      requiresHumanReview: false,
      autoPublishEligible: false,
      classificationMethod: "calibrated_bilingual_v1"
    };
  }

  // Case 4: Industrial factory automation out of scope
  if (topicEval.isIndustrialOutOfScope) {
    return {
      relevanceStatus: "REJECTED",
      relevanceReason: "Heavy industrial assembly line or spot welding machinery excluded from humanoid/service atlas scope.",
      calibratedConfidence: 0.88,
      factors: {
        evidenceSufficiency: sufficiency,
        topicalRelevance: "unrelated",
        thailandConnection: thaiEval.hasConnection,
        hasContradictorySignals: false,
        matchedEmbodiedTerms: topicEval.matchedEmbodiedTerms,
        matchedThailandTerms: thaiEval.matchedTerms,
        matchedSoftwareTerms: []
      },
      requiresHumanReview: false,
      autoPublishEligible: false,
      classificationMethod: "calibrated_bilingual_v1"
    };
  }

  // Case 5: Embodied robotics with verified Thailand connection
  if (topicEval.topicalRelevance === "embodied_robot" && thaiEval.hasConnection) {
    const confidence = hasContradictorySignals ? 0.65 : 0.94;
    const requiresReview = hasContradictorySignals || confidence < 0.80;

    const relevanceStatus = requiresReview ? "UNCERTAIN" : "ACCEPTED";
    const relevanceReason = hasContradictorySignals
      ? "Embodied robotics combined with contradictory mobile/software signals; requires human verification before publication."
      : "Embodied humanoid or service robotics research/deployment with verified Thailand connection.";

    return {
      relevanceStatus,
      relevanceReason,
      calibratedConfidence: confidence,
      factors: {
        evidenceSufficiency: sufficiency,
        topicalRelevance: "embodied_robot",
        thailandConnection: true,
        hasContradictorySignals,
        matchedEmbodiedTerms: topicEval.matchedEmbodiedTerms,
        matchedThailandTerms: thaiEval.matchedTerms,
        matchedSoftwareTerms: topicEval.matchedSoftwareTerms
      },
      requiresHumanReview: requiresReview,
      autoPublishEligible: !requiresReview && confidence >= 0.80,
      classificationMethod: "calibrated_bilingual_v1"
    };
  }

  // Case 6: Embodied robotics but outside Thailand
  if (topicEval.topicalRelevance === "embodied_robot" && !thaiEval.hasConnection) {
    return {
      relevanceStatus: "REJECTED",
      relevanceReason: "Embodied robotics record without verified Thailand institutional or geographic connection.",
      calibratedConfidence: 0.89,
      factors: {
        evidenceSufficiency: sufficiency,
        topicalRelevance: "embodied_robot",
        thailandConnection: false,
        hasContradictorySignals: false,
        matchedEmbodiedTerms: topicEval.matchedEmbodiedTerms,
        matchedThailandTerms: [],
        matchedSoftwareTerms: []
      },
      requiresHumanReview: false,
      autoPublishEligible: false,
      classificationMethod: "calibrated_bilingual_v1"
    };
  }

  // Case 7: Unrelated content
  return {
    relevanceStatus: "REJECTED",
    relevanceReason: "No embodied humanoid or service robotics relevance detected.",
    calibratedConfidence: 0.92,
    factors: {
      evidenceSufficiency: sufficiency,
      topicalRelevance: "unrelated",
      thailandConnection: thaiEval.hasConnection,
      hasContradictorySignals: false,
      matchedEmbodiedTerms: [],
      matchedThailandTerms: thaiEval.matchedTerms,
      matchedSoftwareTerms: []
    },
    requiresHumanReview: false,
    autoPublishEligible: false,
    classificationMethod: "calibrated_bilingual_v1"
  };
}

// ---------------------------------------------------------
// Calibrated Perspective & Stance Extractor (Audit D05)
// ---------------------------------------------------------

const THEME_DEFINITIONS: Array<{
  theme: string;
  regexes: RegExp[];
}> = [
  {
    theme: "job_displacement",
    regexes: [
      /\b(?:replace jobs|job loss|wage cut|layoff|labor union|hospitality union)\b/i,
      /(?:แย่งงาน|ตกงาน|แรงงาน|ลดค่าจ้าง)/i
    ]
  },
  {
    theme: "privacy_and_surveillance",
    regexes: [
      /\b(?:privacy|surveillance|camera|telemetry|encrypt(?:ion|ed|ing)?|personal data|gdpr|pdpa)\b/i,
      /(?:ข้อมูลส่วนบุคคล|การเข้ารหัส|กล้องวงจรปิด|ความปลอดภัยข้อมูล|pdpa)/i
    ]
  },
  {
    theme: "safety_and_reliability",
    regexes: [
      /\b(?:safety|collision|hazard|obstacle avoidance|safe navigation|fail-safe)\b/i,
      /(?:ความปลอดภัย|อุบัติเหตุ|หลบหลีก|ปลอดภัยในการใช้งาน)/i
    ]
  },
  {
    theme: "healthcare_and_eldercare_trust",
    regexes: [
      /\b(?:hospital|eldercare|nursing|doctor|nurse|clinic|patient|siriraj|ramathibodi|rehabilitation|stroke)\b/i,
      /(?:โรงพยาบาล|ผู้ป่วย|การแพทย์|ผู้สูงอายุ|กายภาพบำบัด|สมองเสื่อม)/i
    ]
  },
  {
    theme: "education_and_learning",
    regexes: [
      /\b(?:school|student|education|university|therapy|autistic|stem|learning|curriculum)\b/i,
      /(?:การศึกษา|โรงเรียน|นักเรียน|เยาวชน|เด็ก|การแข่งขันหุ่นยนต์)/i
    ]
  },
  {
    theme: "national_innovation",
    regexes: [
      /\b(?:innovation|startup|thai-made|patent|fibo|kasetsart|kmutt|nectec|nstda)\b/i,
      /(?:นวัตกรรม|ฝีมือคนไทย|แห่งชาติ|เปิดตัวหุ่นยนต์|สวทช)/i
    ]
  },
  {
    theme: "entertainment_and_novelty",
    regexes: [
      /\b(?:expo|show|welcome|greeting|dance|cute|festival|shopping mall|entertainment)\b/i,
      /(?:ต้อนรับ|นิทรรศการ|น่ารัก|การแสดง|บันเทิง|ห้างสรรพสินค้า)/i
    ]
  }
];

export function extractCalibratedPerspective(
  title: string,
  excerpt = ""
): CalibratedPerspectiveResult {
  const fullText = `${title} ${excerpt}`.trim();
  const sufficiency = evaluateEvidenceSufficiency(title, excerpt);

  if (sufficiency !== "sufficient") {
    return {
      stance: "unclear",
      sentiment: "unclear",
      perspectiveTheme: "unclear",
      targetEntity: "humanoid/social robotics in Thailand",
      evidenceExcerpt: "",
      confidence: 0.20,
      method: "abstain_insufficient_evidence",
      requiresHumanReview: true
    };
  }

  // Identify primary perspective theme via occurrence scoring (title matches = 3 pts each, excerpt matches = 1 pt each)
  let bestTheme = "unclear";
  let maxScore = 0;

  for (const def of THEME_DEFINITIONS) {
    let score = 0;
    for (const regex of def.regexes) {
      const globalRegex = new RegExp(regex.source, "gi");
      const titleMatches = title.match(globalRegex);
      if (titleMatches) {
        score += titleMatches.length * 3;
      }
      if (excerpt) {
        const excerptMatches = excerpt.match(globalRegex);
        if (excerptMatches) {
          score += excerptMatches.length;
        }
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestTheme = def.theme;
    }
  }

  const theme = bestTheme;

  // Assess evaluative indicators independently of theme
  const hasPositive = POSITIVE_INDICATORS.some((regex) => regex.test(fullText));
  const hasSkepticalNegative = SKEPTICAL_NEGATIVE_INDICATORS.some((regex) => regex.test(fullText));
  const hasCautiousMixed = CAUTIOUS_MIXED_INDICATORS.some((regex) => regex.test(fullText));

  let stance: "supportive" | "skeptical" | "neutral" | "cautious_supportive" | "unclear" = "neutral";
  let sentiment: "positive" | "negative" | "neutral" | "mixed" | "unclear" = "neutral";

  // Disentangle privacy/surveillance theme from automatic skepticism
  if (theme === "privacy_and_surveillance") {
    if (hasPositive) {
      stance = "supportive";
      sentiment = "positive";
    } else if (hasSkepticalNegative) {
      stance = "skeptical";
      sentiment = "negative";
    } else {
      stance = "neutral";
      sentiment = "neutral";
    }
  } else if (theme === "job_displacement" && hasSkepticalNegative) {
    stance = "skeptical";
    sentiment = "negative";
  } else if (hasCautiousMixed || (hasPositive && hasSkepticalNegative)) {
    stance = "cautious_supportive";
    sentiment = "mixed";
  } else if (hasPositive) {
    stance = "supportive";
    sentiment = "positive";
  } else if (hasSkepticalNegative) {
    stance = "skeptical";
    sentiment = "negative";
  }

  // Target entity heuristic
  let targetEntity = "humanoid/social robots in Thailand";
  if (/dinsaw|ดินสอ/i.test(fullText)) {
    targetEntity = "Dinsaw Robot";
  } else if (/pepper/i.test(fullText)) {
    targetEntity = "Pepper Robot";
  } else if (/nao/i.test(fullText)) {
    targetEntity = "NAO Robot";
  } else if (/atlas/i.test(fullText)) {
    targetEntity = "Atlas Robot";
  } else if (/sensai|แสนดี/i.test(fullText)) {
    targetEntity = "Sensai Robot";
  } else if (/chulalongkorn|จุฬา/i.test(fullText)) {
    targetEntity = "Chulalongkorn University Robotics";
  } else if (/mahidol|siriraj|มหิดล|ศิริราช/i.test(fullText)) {
    targetEntity = "Mahidol University / Siriraj";
  }

  // Verified contiguous excerpt
  const evidenceExcerpt = (excerpt || title).slice(0, 240);

  return {
    stance,
    sentiment,
    perspectiveTheme: theme,
    targetEntity,
    evidenceExcerpt,
    confidence: theme === "unclear" ? 0.50 : 0.85,
    method: "calibrated_evidence_v1",
    requiresHumanReview: false
  };
}
