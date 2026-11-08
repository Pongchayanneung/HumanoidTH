import "server-only";
import { isPublicCheckedRecord } from "@/lib/manifest/demo-manifest";
import { isEligiblePublicRobot, publicSourceRecordWhere } from "@/lib/public-projection";

const dinsawNames = ["Dinsaw Mini Home AI", "Dinsaw Mini Home AI Assistance"];
const dinsawUrl = "https://www.nia.or.th/DinsawMiniHomeAI";
export const dinsawIntendedUse = {
  en: "Care for older adults at home",
  th: "ดูแลผู้สูงอายุที่บ้าน"
};

export async function dinsawSourceForRobot(name: string) {
  if (!dinsawNames.includes(name) || !isEligiblePublicRobot(name) || !isPublicCheckedRecord("robot_model:dinsaw-mini-home-ai")) return null;
  const { prisma } = await import("@/lib/prisma");
  return prisma.sourceRecord.findFirst({
    where: { url: dinsawUrl, ...publicSourceRecordWhere },
    select: { url: true }
  });
}

export async function loadDinsawExample() {
  try {
    const { prisma } = await import("@/lib/prisma");
    const robot = await prisma.robotModel.findFirst({
      where: { canonicalName: { in: dinsawNames } },
      orderBy: { canonicalName: "asc" },
      select: { id: true, canonicalName: true, developerOrg: true, manufacturer: true }
    });
    if (!robot || (robot.developerOrg ?? robot.manufacturer) !== "CT Asia Robotics") return null;
    const source = await dinsawSourceForRobot(robot.canonicalName);
    return source ? { robotId: robot.id, name: robot.canonicalName, url: source.url } : null;
  } catch (error) {
    console.error("Atlas homepage example unavailable:", error);
    return null;
  }
}
