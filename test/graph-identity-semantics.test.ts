import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stableTypedId,
  buildNetworkGraph,
  loadGraphRecordsFromFile,
  mergeRecords,
  normalizeFileRecord,
  filterGraph,
  type AtlasRecord,
  type NetworkGraph
} from "../lib/network-graph";

test("stableTypedId: preserves distinct Thai entity names without collisions (Finding D07)", () => {
  const chulaId = stableTypedId("organization", "จุฬาลงกรณ์มหาวิทยาลัย");
  const kuId = stableTypedId("organization", "มหาวิทยาลัยเกษตรศาสตร์");
  const kmuttId = stableTypedId("organization", "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี");
  const vistecId = stableTypedId("organization", "สถาบันวิทยสิริเมธี (VISTEC)");

  // Assert Thai characters are preserved in the slug portion
  assert.match(chulaId, /^organization:จุฬาลงกรณ์มหาวิทยาลัย_[a-f0-9]{16}$/);
  assert.match(kuId, /^organization:มหาวิทยาลัยเกษตรศาสตร์_[a-f0-9]{16}$/);

  // Assert distinct Thai entities NEVER collide
  assert.notEqual(chulaId, kuId);
  assert.notEqual(chulaId, kmuttId);
  assert.notEqual(kuId, kmuttId);
  assert.notEqual(kmuttId, vistecId);

  // Assert deterministic stability across repeated calls
  assert.equal(stableTypedId("organization", "จุฬาลงกรณ์มหาวิทยาลัย"), chulaId);
});

test("stableTypedId: preserves distinct long names sharing prefix without collisions (Finding D07)", () => {
  const commonPrefix = "Laboratory for Autonomous Humanoid Robotics and Cognitive Biometrics Research Institute ";
  const nameA = commonPrefix + "Division of Medical Rehabilitation Systems";
  const nameB = commonPrefix + "Division of Industrial Manufacturing Applications";

  const idA = stableTypedId("organization", nameA);
  const idB = stableTypedId("organization", nameB);

  assert.notEqual(idA, idB, "Distinct long names must produce different typed IDs despite common prefix");
  assert.equal(idA, stableTypedId("organization", nameA), "Must be deterministic");
});

test("graph semantics: borrowed or leased inventory never gets an owned_by claim (Finding D08)", async () => {
  const records: AtlasRecord[] = [
    {
      id: "inv_borrowed",
      category: "owned_inventory",
      title: "NAO Unit borrowed from partner",
      canonical_name: "NAO Borrowed",
      description: "Field test robot on temporary loan",
      organization: "KMUTT FIBO",
      country: null,
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: "borrowed", // ownershipStatus
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "instance_of",
      subject: "NAO Unit borrowed",
      object: "NAO",
      url: null,
      source_platform: "owned_inventory",
      published_at: null,
      author: null,
      confidence: 0.85,
      evidence_excerpt: "Temporary loan agreement",
      notes: null,
      data_origin: "database"
    },
    {
      id: "inv_leased",
      category: "owned_inventory",
      title: "Pepper Unit leased for mall trial",
      canonical_name: "Pepper Leased",
      description: "Commercial evaluation unit",
      organization: "Retail Corp",
      country: null,
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: "leased", // ownershipStatus
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "instance_of",
      subject: "Pepper Unit leased",
      object: "Pepper",
      url: null,
      source_platform: "owned_inventory",
      published_at: null,
      author: null,
      confidence: 0.85,
      evidence_excerpt: null,
      notes: null,
      data_origin: "database"
    },
    {
      id: "inv_deployed",
      category: "owned_inventory",
      title: "Unit Deployed in Hospital",
      canonical_name: "Unit Deployed",
      description: "Field deployment unit",
      organization: "Siriraj Hospital",
      country: null,
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: "deployed", // unmodeled status
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "instance_of",
      subject: "Unit Deployed in Hospital",
      object: "Dinsaw",
      url: null,
      source_platform: "owned_inventory",
      published_at: null,
      author: null,
      confidence: 0.85,
      evidence_excerpt: null,
      notes: null,
      data_origin: "database"
    },
    {
      id: "inv_owned",
      category: "owned_inventory",
      title: "Dinsaw Unit Owned",
      canonical_name: "Dinsaw Unit Owned",
      description: "Permanently acquired unit",
      organization: "CT Asia Robotics",
      country: null,
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: "owned", // ownershipStatus
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "instance_of",
      subject: "Dinsaw Unit Owned",
      object: "Dinsaw",
      url: null,
      source_platform: "owned_inventory",
      published_at: null,
      author: null,
      confidence: 0.85,
      evidence_excerpt: null,
      notes: null,
      data_origin: "database"
    }
  ];

  const graph = await buildNetworkGraph({ records, sourceMode: "file" });

  const borrowedEdges = graph.edges.filter((e) => e.description.includes("borrowed from partner"));
  assert.ok(borrowedEdges.length > 0);
  assert.ok(
    !borrowedEdges.some((e) => e.relation === "owned_by"),
    "Borrowed inventory must never receive an owned_by relationship"
  );
  assert.ok(borrowedEdges.some((e) => e.relation === "borrowed_from"), "Borrowed inventory must use borrowed_from relationship");
  assert.match(borrowedEdges.find((e) => e.relation === "borrowed_from")!.description, /borrowed from KMUTT FIBO/);

  const leasedEdges = graph.edges.filter((e) => e.description.includes("leased for mall trial"));
  assert.ok(leasedEdges.length > 0);
  assert.ok(
    !leasedEdges.some((e) => e.relation === "owned_by"),
    "Leased inventory must never receive an owned_by relationship"
  );
  assert.ok(leasedEdges.some((e) => e.relation === "leased_from"), "Leased inventory must use leased_from relationship");
  assert.match(leasedEdges.find((e) => e.relation === "leased_from")!.description, /leased from Retail Corp/);

  const deployedEdges = graph.edges.filter((e) => e.description.includes("Unit Deployed in Hospital"));
  assert.ok(deployedEdges.length > 0);
  assert.ok(
    !deployedEdges.some((e) => e.relation === "owned_by"),
    "Deployed inventory must never collapse to owned_by relationship"
  );
  assert.ok(
    deployedEdges.some((e) => e.relation === "held_by"),
    "Unmodeled inventory status must use held_by relationship fallback"
  );
  assert.match(deployedEdges.find((e) => e.relation === "held_by")!.description, /is held by Siriraj Hospital/);

  const ownedEdges = graph.edges.filter((e) => e.description.includes("Dinsaw Unit Owned"));
  assert.ok(ownedEdges.length > 0);
  assert.ok(ownedEdges.some((e) => e.relation === "owned_by"));
  assert.match(ownedEdges.find((e) => e.relation === "owned_by")!.description, /is owned by CT Asia Robotics/);
});

test("graph semantics: unreviewed entities do not fabricate reviewed assertions and are excluded by onlyReviewed (Finding 1)", async () => {
  // 1. normalizeFileRecord does not fabricate reviewed assertions for unreviewed entities
  const unreviewedFileRobot = normalizeFileRecord({
    id: "file_robot_pending",
    category: "robot_model",
    title: "Unreviewed File Robot",
    verification_status: "PENDING",
    is_reviewed: false
  }, 0);
  assert.equal(unreviewedFileRobot.is_reviewed, false, "normalizeFileRecord must preserve is_reviewed=false");
  assert.equal(unreviewedFileRobot.verification_status, "PENDING");
  assert.equal(unreviewedFileRobot.evidence_kind, "inferred_relation", "normalizeFileRecord must not fabricate reviewed_assertion");

  const unreviewedFileInv = normalizeFileRecord({
    id: "file_inv_unreviewed",
    category: "owned_inventory",
    title: "Unreviewed File Inventory",
    contribution_type: "deployed"
  }, 1);
  assert.equal(unreviewedFileInv.is_reviewed, false, "normalizeFileRecord must not default inventory to reviewed");
  assert.equal(unreviewedFileInv.evidence_kind, "inferred_relation");

  // 2. buildNetworkGraph preserves unreviewed status for robot models, inventory, developer edges, and country edges
  const records: AtlasRecord[] = [
    {
      id: "robot_unreviewed",
      category: "robot_model",
      title: "Prototype Robot X",
      canonical_name: "Prototype Robot X",
      description: "Unverified robot prototype",
      organization: "Emerging Robotics Lab",
      country: "Thailand",
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: null,
      source_platform: null,
      published_at: null,
      author: null,
      confidence: 0.65,
      evidence_excerpt: null,
      notes: null,
      verification_status: "PENDING",
      is_reviewed: false,
      evidence_kind: "inferred_relation",
      data_origin: "database"
    },
    {
      id: "inv_unreviewed",
      category: "owned_inventory",
      title: "Prototype Unit #01",
      canonical_name: "Prototype Unit #01",
      description: "Field prototype unit",
      organization: "FIBO Testbed",
      country: null,
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: "evaluation",
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "instance_of",
      subject: "Prototype Unit #01",
      object: "Prototype Robot X",
      url: null,
      source_platform: "owned_inventory",
      published_at: null,
      author: null,
      confidence: 0.65,
      evidence_excerpt: null,
      notes: null,
      verification_status: "PENDING",
      is_reviewed: false,
      evidence_kind: "inferred_relation",
      data_origin: "database"
    },
    {
      id: "robot_approved",
      category: "robot_model",
      title: "Curated Robot Pro",
      canonical_name: "Curated Robot Pro",
      description: "Peer-verified robot model",
      organization: "Verified Systems Inc",
      country: "Japan",
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: "https://example.com/robot-pro",
      source_platform: "curated_catalog",
      published_at: null,
      author: null,
      confidence: 0.95,
      evidence_excerpt: null,
      notes: "APPROVED",
      verification_status: "APPROVED",
      is_reviewed: true,
      evidence_kind: "reviewed_assertion",
      data_origin: "database"
    }
  ];

  const graph = await buildNetworkGraph({ records, sourceMode: "file" });

  // Assert unreviewed robot node semantics
  const unreviewedNode = graph.nodes.find((n) => n.label === "Prototype Robot X");
  assert.ok(unreviewedNode, "Unreviewed robot node must exist");
  assert.equal(unreviewedNode.is_reviewed, false, "Unreviewed robot node must have is_reviewed=false");
  assert.equal(unreviewedNode.review_status, "PENDING");
  assert.equal(unreviewedNode.evidence_kind, "inferred_relation", "Unreviewed robot node must have evidence_kind=inferred_relation");

  // Assert unreviewed developer edge semantics
  const unreviewedDevEdge = graph.edges.find((e) => e.relation === "developed_by" && e.source === unreviewedNode.id);
  assert.ok(unreviewedDevEdge, "developed_by edge for unreviewed robot must exist");
  assert.equal(unreviewedDevEdge.is_reviewed, false, "developed_by edge for unreviewed robot must have is_reviewed=false");
  assert.equal(unreviewedDevEdge.review_status, "PENDING");
  assert.equal(unreviewedDevEdge.evidence_kind, "inferred_relation", "developed_by edge for unreviewed robot must have evidence_kind=inferred_relation");

  // Assert unreviewed origin_country edge semantics
  const unreviewedCountryEdge = graph.edges.find((e) => e.relation === "origin_country" && e.source === unreviewedNode.id);
  assert.ok(unreviewedCountryEdge, "origin_country edge for unreviewed robot must exist");
  assert.equal(unreviewedCountryEdge.is_reviewed, false, "origin_country edge for unreviewed robot must have is_reviewed=false");
  assert.equal(unreviewedCountryEdge.evidence_kind, "inferred_relation", "origin_country edge for unreviewed robot must have evidence_kind=inferred_relation");

  // Assert unreviewed inventory node and edges semantics
  const unreviewedInvNode = graph.nodes.find((n) => n.label === "Prototype Unit #01");
  assert.ok(unreviewedInvNode, "Unreviewed inventory node must exist");
  assert.equal(unreviewedInvNode.is_reviewed, false, "Unreviewed inventory node must have is_reviewed=false");
  assert.equal(unreviewedInvNode.evidence_kind, "inferred_relation");

  const invInstanceOfEdge = graph.edges.find((e) => e.relation === "instance_of" && e.source === unreviewedInvNode.id);
  assert.ok(invInstanceOfEdge, "instance_of edge for unreviewed inventory must exist");
  assert.equal(invInstanceOfEdge.is_reviewed, false, "instance_of edge for unreviewed inventory must have is_reviewed=false");
  assert.equal(invInstanceOfEdge.evidence_kind, "inferred_relation");

  const invHolderEdge = graph.edges.find((e) => e.source === unreviewedInvNode.id && e.relation === "held_by");
  assert.ok(invHolderEdge, "held_by edge for unreviewed inventory must exist");
  assert.equal(invHolderEdge.is_reviewed, false, "held_by edge for unreviewed inventory must have is_reviewed=false");
  assert.equal(invHolderEdge.evidence_kind, "inferred_relation");

  // Assert approved robot model retains reviewed assertion
  const approvedNode = graph.nodes.find((n) => n.label === "Curated Robot Pro");
  assert.ok(approvedNode);
  assert.equal(approvedNode.is_reviewed, true);
  assert.equal(approvedNode.review_status, "APPROVED");
  assert.equal(approvedNode.evidence_kind, "reviewed_assertion");

  const approvedDevEdge = graph.edges.find((e) => e.relation === "developed_by" && e.source === approvedNode.id);
  assert.ok(approvedDevEdge);
  assert.equal(approvedDevEdge.is_reviewed, true);
  assert.equal(approvedDevEdge.review_status, "APPROVED");
  assert.equal(approvedDevEdge.evidence_kind, "reviewed_assertion");

  // 3. Assert onlyReviewed filter EXCLUDES unreviewed robot and inventory nodes and edges
  const filtered = filterGraph(graph, {}, {
    showLowConfidence: true,
    onlyReviewed: true,
    showOwned: true,
    showMedia: true,
    showAcademic: true
  });

  assert.ok(
    !filtered.nodes.some((n) => n.label === "Prototype Robot X"),
    "onlyReviewed MUST exclude unreviewed robot model"
  );
  assert.ok(
    !filtered.nodes.some((n) => n.label === "Prototype Unit #01"),
    "onlyReviewed MUST exclude unreviewed inventory item"
  );
  assert.ok(
    !filtered.edges.some((e) => e.source === unreviewedNode.id),
    "onlyReviewed MUST exclude edges originating from unreviewed robot"
  );
  assert.ok(
    !filtered.edges.some((e) => e.source === unreviewedInvNode.id),
    "onlyReviewed MUST exclude edges originating from unreviewed inventory"
  );

  // Assert approved entities ARE retained
  assert.ok(
    filtered.nodes.some((n) => n.label === "Curated Robot Pro"),
    "onlyReviewed MUST retain approved robot model"
  );
  assert.ok(
    filtered.edges.some((e) => e.relation === "developed_by" && e.source === approvedNode.id),
    "onlyReviewed MUST retain approved robot developer edge"
  );
});

test("graph semantics: robot country of origin never becomes deployment location (Finding D08)", async () => {
  const records: AtlasRecord[] = [
    {
      id: "robot_pepper",
      category: "robot_model",
      title: "Pepper",
      canonical_name: "Pepper",
      description: "Commercial humanoid developed in Japan",
      organization: "SoftBank Robotics",
      country: "Japan", // countryOfOrigin
      robot_type: "humanoid",
      embodiment_level: "full",
      contribution_type: "service",
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: "https://example.com/pepper",
      source_platform: "robot_model_record",
      published_at: null,
      author: null,
      confidence: 0.95,
      evidence_excerpt: "Manufactured by SoftBank Robotics in Japan",
      notes: null,
      data_origin: "database"
    }
  ];

  const graph = await buildNetworkGraph({ records, sourceMode: "file" });

  const japanEdges = graph.edges.filter((e) => e.description.includes("Japan"));
  assert.ok(japanEdges.length > 0);
  assert.ok(
    !japanEdges.some((e) => e.relation === "located_in"),
    "Robot country of origin must never become a located_in deployment relationship"
  );
  assert.ok(
    japanEdges.some((e) => e.relation === "origin_country"),
    "Robot country of origin must use origin_country relationship"
  );
  assert.match(japanEdges[0].description, /originates from Japan/);
});

test("graph semantics: reviewed assertions vs inferred relations are distinct, and onlyReviewed excludes unreviewed high-confidence edges (Finding D08)", async () => {
  const records: AtlasRecord[] = [
    {
      id: "reviewed_contrib",
      category: "contribution",
      title: "Validated Elderly Care Trial",
      canonical_name: "Validated Elderly Care Trial",
      description: "Human-reviewed hospital trial",
      organization: "Chulalongkorn Hospital",
      country: null,
      robot_type: "humanoid",
      embodiment_level: null,
      contribution_type: "research",
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: "https://example.org/study",
      source_platform: "contribution_record",
      published_at: null,
      author: null,
      confidence: 0.9,
      evidence_excerpt: "Peer-reviewed methodology",
      notes: "APPROVED",
      verification_status: "APPROVED",
      is_reviewed: true,
      evidence_kind: "reviewed_assertion",
      data_origin: "database"
    },
    {
      id: "inferred_triplet",
      category: "triplet_relation",
      title: "Dinsaw assists Patients",
      canonical_name: "Dinsaw -> assists -> Patients",
      description: "NLP-extracted relationship",
      organization: null,
      country: null,
      robot_type: null,
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "assists",
      subject: "Dinsaw",
      object: "Patients",
      url: null,
      source_platform: "nlp_extractor",
      published_at: null,
      author: null,
      confidence: 0.95, // High confidence, but UNREVIEWED machine inference!
      evidence_excerpt: "Text mined from web article",
      notes: null,
      data_origin: "database"
    }
  ];

  const graph = await buildNetworkGraph({ records, sourceMode: "file" });

  const reviewedNode = graph.nodes.find((n) => n.label === "Validated Elderly Care Trial");
  assert.ok(reviewedNode);
  assert.equal(reviewedNode.is_reviewed, true);
  assert.equal(reviewedNode.review_status, "APPROVED");
  assert.equal(reviewedNode.evidence_kind, "reviewed_assertion");

  const inferredEdge = graph.edges.find((e) => e.relation === "assists");
  assert.ok(inferredEdge);
  assert.equal(inferredEdge.is_reviewed, false);
  assert.equal(inferredEdge.review_status, "inferred");
  assert.equal(inferredEdge.evidence_kind, "inferred_relation");
  assert.equal(inferredEdge.confidence, 0.95);

  // Exercise filterGraph and onlyReviewed toggle (Finding 3 fix)
  const defaultToggles = {
    showLowConfidence: true,
    onlyReviewed: false,
    showOwned: true,
    showMedia: true,
    showAcademic: true
  };

  const unfiltered = filterGraph(graph, {}, defaultToggles);
  assert.ok(
    unfiltered.edges.some((e) => e.relation === "assists"),
    "Inferred relation must be present when onlyReviewed is false"
  );

  const reviewedOnly = filterGraph(graph, {}, { ...defaultToggles, onlyReviewed: true });
  assert.ok(
    !reviewedOnly.edges.some((e) => e.relation === "assists"),
    "onlyReviewed MUST exclude unreviewed machine inferences even if confidence is high (0.95)"
  );
  assert.ok(
    reviewedOnly.nodes.some((n) => n.label === "Validated Elderly Care Trial"),
    "Reviewed assertions must be retained when onlyReviewed is true"
  );

  // Also verify buildNetworkGraph server-side option with onlyReviewed: true
  const serverFilteredGraph = await buildNetworkGraph({ records, sourceMode: "file", onlyReviewed: true });
  assert.ok(
    !serverFilteredGraph.edges.some((e) => e.relation === "assists"),
    "buildNetworkGraph with onlyReviewed: true must exclude unreviewed edges"
  );
  assert.ok(
    serverFilteredGraph.nodes.some((n) => n.label === "Validated Elderly Care Trial"),
    "buildNetworkGraph with onlyReviewed: true must retain reviewed nodes"
  );
});

test("node merging: inventory owner merges with existing organization node without case divergence (Finding 1)", async () => {
  // Verify stableTypedId is case-insensitive for entity merging
  const upperId = stableTypedId("organization", "CT Asia Robotics");
  const lowerId = stableTypedId("organization", "ct asia robotics");
  const mixedId = stableTypedId("organization", "KMUTT FIBO");
  const lowerMixedId = stableTypedId("organization", "kmutt fibo");

  assert.equal(upperId, lowerId, "stableTypedId must produce identical IDs regardless of casing for CT Asia Robotics");
  assert.equal(mixedId, lowerMixedId, "stableTypedId must produce identical IDs regardless of casing for KMUTT FIBO");

  const records: AtlasRecord[] = [
    {
      id: "robot_dinsaw",
      category: "robot_model",
      title: "Dinsaw Robot",
      canonical_name: "Dinsaw Robot",
      description: "Thai-developed service robot",
      organization: "CT Asia Robotics",
      country: "Thailand",
      robot_type: "social_service_robot",
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: "https://example.com/dinsaw",
      source_platform: "official_website",
      published_at: null,
      author: null,
      confidence: 0.95,
      evidence_excerpt: "Developed by CT Asia Robotics",
      notes: null,
      verification_status: "APPROVED",
      is_reviewed: true,
      evidence_kind: "reviewed_assertion",
      data_origin: "database"
    },
    {
      id: "inv_dinsaw_01",
      category: "owned_inventory",
      title: "Dinsaw Unit #1",
      canonical_name: "Dinsaw Unit #1",
      description: "Inventory unit",
      organization: "CT Asia Robotics",
      country: null,
      robot_type: "social_service_robot",
      embodiment_level: null,
      contribution_type: "owned",
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: "instance_of",
      subject: "Dinsaw Unit #1",
      object: "Dinsaw Robot",
      url: null,
      source_platform: "owned_inventory",
      published_at: null,
      author: null,
      confidence: 0.9,
      evidence_excerpt: null,
      notes: null,
      verification_status: "APPROVED",
      is_reviewed: true,
      evidence_kind: "reviewed_assertion",
      data_origin: "database"
    }
  ];

  const graph = await buildNetworkGraph({ records, sourceMode: "file" });

  const orgNodes = graph.nodes.filter(
    (n) => n.type === "organization" && n.label.toLowerCase() === "ct asia robotics"
  );
  assert.equal(
    orgNodes.length,
    1,
    `Expected exactly 1 merged organization node for 'CT Asia Robotics', found ${orgNodes.length}`
  );
  assert.equal(orgNodes[0].label, "CT Asia Robotics");
  assert.equal(orgNodes[0].id, upperId);

  // Both the robot model and the inventory node should connect to this single organization node
  const developedByEdge = graph.edges.find((e) => e.relation === "developed_by");
  const ownedByEdge = graph.edges.find((e) => e.relation === "owned_by");
  assert.ok(developedByEdge, "developed_by edge must exist");
  assert.ok(ownedByEdge, "owned_by edge must exist");
  assert.equal(developedByEdge.target, orgNodes[0].id);
  assert.equal(ownedByEdge.target, orgNodes[0].id);
});

test("data sources: approved contributions and author edges default to reviewed assertions (Finding 2)", async () => {
  // 1. Verify normalizeFileRecord preserves approval review status from file data
  const rawFileItem = {
    id: "contrib_elderly_care",
    category: "contribution",
    title: "Elderly Care Robot Observation Study",
    canonical_name: "Elderly Care Robot Observation Study",
    description: "Clinical evaluation trial at Chulalongkorn Hospital",
    organization: "Chulalongkorn University",
    author: "Dr. Somchai Prasert",
    notes: "APPROVED",
    confidence: 0.92,
    source_platform: "contribution_record"
  };

  const normalized = normalizeFileRecord(rawFileItem, 0);
  assert.equal(normalized.is_reviewed, true, "normalizeFileRecord must set is_reviewed=true for APPROVED records");
  assert.equal(normalized.verification_status, "APPROVED", "normalizeFileRecord must set verification_status=APPROVED");
  assert.equal(normalized.evidence_kind, "reviewed_assertion", "normalizeFileRecord must set evidence_kind=reviewed_assertion");

  // 2. Build graph from this normalized contribution record and check node and author edge semantics
  const graph = await buildNetworkGraph({ records: [normalized], sourceMode: "file" });

  const contribNode = graph.nodes.find((n) => n.label === "Elderly Care Robot Observation Study");
  assert.ok(contribNode, "Contribution node must exist");
  assert.equal(contribNode.is_reviewed, true, "Contribution node must be reviewed");
  assert.equal(contribNode.review_status, "APPROVED");
  assert.equal(contribNode.evidence_kind, "reviewed_assertion");

  const authorNode = graph.nodes.find((n) => n.label === "Dr. Somchai Prasert");
  assert.ok(authorNode, "Author node must exist");
  assert.equal(authorNode.is_reviewed, true, "Author node of approved contribution must be reviewed");
  assert.equal(authorNode.review_status, "APPROVED");
  assert.equal(authorNode.evidence_kind, "reviewed_assertion");

  const authorEdge = graph.edges.find((e) => e.relation === "authored_by");
  assert.ok(authorEdge, "authored_by edge must exist");
  assert.equal(authorEdge.is_reviewed, true, "authored_by edge of approved contribution must be reviewed");
  assert.equal(authorEdge.review_status, "APPROVED");
  assert.equal(authorEdge.evidence_kind, "reviewed_assertion");

  // 3. Verify onlyReviewed filter retains the author and authored_by relationship
  const filtered = filterGraph(graph, {}, {
    showLowConfidence: true,
    onlyReviewed: true,
    showOwned: true,
    showMedia: true,
    showAcademic: true
  });

  assert.ok(
    filtered.edges.some((e) => e.relation === "authored_by"),
    "authored_by edge of approved contribution must NOT be dropped by onlyReviewed"
  );
  assert.ok(
    filtered.nodes.some((n) => n.label === "Dr. Somchai Prasert"),
    "Author of approved contribution must NOT be dropped by onlyReviewed"
  );
});

test("graph semantics: curated robot developer relationship is marked reviewed assertion (Finding 4)", async () => {
  const records: AtlasRecord[] = [
    {
      id: "robot_dinsaw",
      category: "robot_model",
      title: "Dinsaw Robot",
      canonical_name: "Dinsaw Robot",
      description: "Service robot",
      organization: "CT Asia Robotics",
      country: "Thailand",
      robot_type: "social_service_robot",
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: "https://example.com/dinsaw",
      source_platform: "official_website",
      published_at: null,
      author: null,
      confidence: 0.95,
      evidence_excerpt: "Developed by CT Asia Robotics",
      notes: null,
      verification_status: "APPROVED",
      is_reviewed: true,
      evidence_kind: "reviewed_assertion",
      data_origin: "database"
    }
  ];

  const graph = await buildNetworkGraph({ records, sourceMode: "file" });
  const devEdge = graph.edges.find((e) => e.relation === "developed_by");
  assert.ok(devEdge, "developed_by edge must exist");
  assert.equal(devEdge.is_reviewed, true, "developed_by edge of curated robot model must be reviewed");
  assert.equal(devEdge.review_status, "APPROVED");
  assert.equal(devEdge.evidence_kind, "reviewed_assertion");

  const filtered = filterGraph(graph, {}, {
    showLowConfidence: true,
    onlyReviewed: true,
    showOwned: true,
    showMedia: true,
    showAcademic: true
  });
  assert.ok(
    filtered.edges.some((e) => e.relation === "developed_by"),
    "developed_by edge of curated robot model must NOT be dropped by onlyReviewed"
  );
});

test("hybrid deduplication: long entity records sharing 80-character prefix never collide (Finding 5)", async () => {
  const prefix = "Laboratory for Autonomous Humanoid Robotics and Biometrics Research Institute Thailand ";
  const recA: AtlasRecord = {
    id: "rec_a",
    category: "contribution",
    title: prefix + "Division of Medical Rehabilitation Systems",
    canonical_name: prefix + "Division of Medical Rehabilitation Systems",
    description: "System A",
    organization: null,
    country: null,
    robot_type: null,
    embodiment_level: null,
    contribution_type: null,
    stance: null,
    sentiment: null,
    perspective_theme: null,
    relation: null,
    subject: null,
    object: null,
    url: null,
    source_platform: null,
    published_at: null,
    author: null,
    confidence: 0.8,
    evidence_excerpt: null,
    notes: null,
    data_origin: "database"
  };

  const recB: AtlasRecord = {
    id: "rec_b",
    category: "contribution",
    title: prefix + "Division of Industrial Manufacturing Applications",
    canonical_name: prefix + "Division of Industrial Manufacturing Applications",
    description: "System B",
    organization: null,
    country: null,
    robot_type: null,
    embodiment_level: null,
    contribution_type: null,
    stance: null,
    sentiment: null,
    perspective_theme: null,
    relation: null,
    subject: null,
    object: null,
    url: null,
    source_platform: null,
    published_at: null,
    author: null,
    confidence: 0.8,
    evidence_excerpt: null,
    notes: null,
    data_origin: "import_file"
  };

  // Go through the real hybrid merge/dedupe path (database + import file), then build the graph from it.
  const merged = mergeRecords([recA], [{ ...recB, data_origin: "import_file" }]);
  assert.equal(merged.length, 2, "dedupeKey/mergeRecords must keep the two distinct long records apart");
  const graph = await buildNetworkGraph({ records: merged, sourceMode: "file" });
  assert.equal(
    graph.nodes.filter((n) => n.type === "contribution").length,
    2,
    "Distinct long entity records must not collide into a single node during hybrid merge"
  );
});

test("hybrid deduplication: the same record from database and import file merges into one node", async () => {
  const base: AtlasRecord = {
    id: "dup_db", category: "contribution", title: "Shared Contribution", canonical_name: "Shared Contribution",
    description: null, organization: null, country: null, robot_type: null, embodiment_level: null,
    contribution_type: null, stance: null, sentiment: null, perspective_theme: null, relation: null,
    subject: null, object: null, url: "https://example.org/shared", source_platform: null, published_at: null,
    author: null, confidence: 0.8, evidence_excerpt: null, notes: null, data_origin: "database"
  };
  const merged = mergeRecords([base], [{ ...base, id: "dup_file", data_origin: "import_file" }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].data_origin, "merged");
  assert.deepEqual(merged[0].source_record_ids, ["dup_db"]);
  assert.deepEqual(merged[0].import_record_ids, ["dup_file"]);
  const graph = await buildNetworkGraph({ records: merged, sourceMode: "file" });
  assert.equal(graph.nodes.filter((n) => n.type === "contribution").length, 1);
});

test("stableTypedId: names sharing a 50-char slug prefix and a 32-bit hash prefix stay distinct (Finding 1, round 2)", () => {
  // Found by search: both labels share the first 8 hex chars of their SHA-256 (82cd1245).
  const a = stableTypedId("organization", "laboratory of autonomous humanoid robotics and systems research 6620");
  const b = stableTypedId("organization", "laboratory of autonomous humanoid robotics and systems research 18466");
  assert.notEqual(a, b);
});

test("graph semantics: a name shared by two record types keeps each record's own edges (Finding 2, round 2)", async () => {
  const mk = (id: string, category: string, extra: Partial<AtlasRecord>): AtlasRecord => ({
    id, category, title: "Shared", canonical_name: "Shared", description: null, organization: null, country: null,
    robot_type: null, embodiment_level: null, contribution_type: null, stance: null, sentiment: null,
    perspective_theme: null, relation: null, subject: null, object: null, url: null, source_platform: null,
    published_at: null, author: null, confidence: 0.9, evidence_excerpt: null, notes: null, data_origin: "import_file",
    ...extra
  });
  const robot = mk("r1", "robot_model", { organization: "Maker Lab", country: "Thailand" });
  const contribution = mk("c1", "contribution", {});
  const graph = await buildNetworkGraph({ records: [robot, contribution], sourceMode: "file" });
  const robotNode = graph.nodes.find((n) => n.type === "robot_model" && n.label === "Shared");
  const contributionNode = graph.nodes.find((n) => n.type === "contribution" && n.label === "Shared");
  assert.ok(robotNode && contributionNode && robotNode.id !== contributionNode.id);
  const developedBy = graph.edges.filter((e) => e.relation === "developed_by");
  assert.ok(developedBy.length > 0, "robot has a developed_by edge");
  for (const edge of developedBy) assert.equal(edge.source, robotNode.id, "developed_by must start at the robot, not the contribution");
  assert.ok(!graph.edges.some((e) => e.source === contributionNode.id && e.relation === "developed_by"));
});

test("graph semantics: a reviewed edge merged over an inferred one never keeps the inferred excerpt (Finding 3, round 2)", async () => {
  const mk = (id: string, reviewed: boolean, excerpt: string): AtlasRecord => ({
    id, category: "robot_model", title: "Merge Bot", canonical_name: "Merge Bot", description: null,
    organization: "Merge Org", country: null, robot_type: null, embodiment_level: null, contribution_type: null,
    stance: null, sentiment: null, perspective_theme: null, relation: null, subject: null, object: null,
    url: "https://example.org/merge", source_platform: null, published_at: null, author: null, confidence: 0.9,
    evidence_excerpt: excerpt, notes: null, data_origin: "import_file",
    is_reviewed: reviewed, verification_status: reviewed ? "APPROVED" : null
  });
  for (const order of [["inferred", "reviewed"], ["reviewed", "inferred"]] as const) {
    const recs = order.map((k, i) => (k === "reviewed" ? mk(`m${i}`, true, "VERIFIED EXCERPT") : mk(`m${i}`, false, "MACHINE EXCERPT")));
    // Distinct ids/dedupe keys are irrelevant here: both records yield the same developed_by edge id.
    const graph = await buildNetworkGraph({ records: recs, sourceMode: "file" });
    const edges = graph.edges.filter((e) => e.relation === "developed_by");
    assert.equal(edges.length, 1, `order ${order.join("->")}: one merged edge`);
    assert.equal(edges[0].is_reviewed, true);
    assert.equal(edges[0].evidence_kind, "reviewed_assertion");
    assert.equal(edges[0].evidence_excerpt, "VERIFIED EXCERPT");
  }
});

test("graph file loader: loads public records while preserving M3 privacy and excluding Bumi", async () => {
  const records = await loadGraphRecordsFromFile();
  assert.ok(records.length > 0);
  const robotNames = records
    .filter((r) => r.category === "robot_model")
    .map((r) => (r.canonical_name || "").toLowerCase());
  assert.ok(!robotNames.some((n) => n.includes("bumi")), "excluded robot Bumi must not reach the graph");
  assert.ok(!records.some((r) => r.category === "submission_record"));
  assert.ok(!records.some((r) => r.category === "source_pull_job"));
});
