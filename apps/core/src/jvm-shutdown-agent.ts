import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function buildJvmShutdownAgent(outputRoot: string): Promise<string> {
  const classesRoot = path.join(outputRoot, "classes");
  const manifestPath = path.join(outputRoot, "MANIFEST.MF");
  const agentJarPath = path.join(outputRoot, "comic-free-shutdown-agent.jar");
  const sourcePath = path.resolve(
    import.meta.dirname,
    "../java/comicfree/shutdown/ComicFreeShutdownAgent.java",
  );

  await mkdir(classesRoot, { recursive: true });
  await writeFile(
    manifestPath,
    "Manifest-Version: 1.0\nPremain-Class: comicfree.shutdown.ComicFreeShutdownAgent\n\n",
    "utf8",
  );
  await execFileAsync("javac", [
    "--add-modules",
    "jdk.httpserver",
    "-d",
    classesRoot,
    sourcePath,
  ]);
  await execFileAsync("jar", [
    "--create",
    "--file",
    agentJarPath,
    "--manifest",
    manifestPath,
    "-C",
    classesRoot,
    ".",
  ]);
  return agentJarPath;
}
