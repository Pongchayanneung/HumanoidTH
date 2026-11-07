import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stableTypedId,
  buildNetworkGraph,
  loadGraphRecordsFromFile,
  type AtlasRecord,
  type NetworkGraph
} from "../lib/network-graph";

test("stableTypedId: preserves distinct Thai entity names without collisions (Finding D07)", () => {
  const chulaId = stableTypedId("organization", "จุฬาลงกรณ์มหาวิทยาลัย");
  const kuId = stableTypedId("organization", "มหาวิทยาลัยเกษตรศาสตร์");
  const kmuttId = stableTypedId("organization", "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี");
  const vistecId = stableTypedId("organization", "สถาบันวิทยสิริเมธี (VISTEC)");

  // Assert Thai characters are preserved in the slug portion
  assert.match(chulaId, /^organization:จุฬาลงกรณ์มหาวิทยาลัย_[a-f0-9]{8}$/);
  assert.match(kuId, /^organization:มหาวิทยาลัยเกษตรศาสตร์_[a-f0-9]{8}$/);

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
  assert.ok(borrowedEdges.some((e) => e.relation === "borrowed_by"));

  const leasedEdges = graph.edges.filter((e) => e.description.includes("leased for mall trial"));
  assert.ok(leasedEdges.length > 0);
  assert.ok(
    !leasedEdges.some((e) => e.relation === "owned_by"),
    "Leased inventory must never receive an owned_by relationship"
  );
  assert.ok(leasedEdges.some((e) => e.relation === "leased_by"));

  const ownedEdges = graph.edges.filter((e) => e.description.includes("Dinsaw Unit Owned"));
  assert.ok(ownedEdges.length > 0);
  assert.ok(ownedEdges.some((e) => e.relation === "owned_by"));
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
