// Local Docker preview adapter. Each checkout owns its credentials, Compose project and previous images.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const url = "http://127.0.0.1:4317";
const release = "dist/app.tgz";
const cfg = "ops/dev";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const project = () => `xtdev${hash(gitValue("--absolute-git-dir")).slice(0, 16)}`;
const imageTag = (digest) => `${project()}:${validatedDigest(digest)}`;

function validatedDigest(value) {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) throw new Error("Digest bản dev không hợp lệ");
  return value;
}

function subject(archive) {
  return hash(`${release}\0${hash(readFileSync(archive))}\n`);
}

function gitValue(...args) {
  return execFileSync("git", ["rev-parse", ...args], { encoding: "utf8" }).trim();
}

function stateDirectory() {
  const expected = join(gitValue("--absolute-git-dir"), "xt-preview", "dev");
  if (process.env.XT_DEPLOY_STATE && resolve(process.env.XT_DEPLOY_STATE) !== expected) {
    throw new Error("XT_DEPLOY_STATE phải thuộc thư mục Git của dự án");
  }
  return expected;
}

function readAccess(state, create = false) {
  const file = join(state, "preview-access.json");
  if (create && !existsSync(file)) {
    mkdirSync(state, { recursive: true, mode: 0o700 });
    const generate = () => randomBytes(32).toString("hex");
    const access = {
      owner: { email: "owner@example.test", password: generate() },
      guest: { email: "guest@example.test", password: generate() },
      database: generate(),
    };
    // Publish after the file is completely written; coordinator serializes deploys.
    const tmp = join(state, `access-${randomBytes(8).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, JSON.stringify(access), { mode: 0o600, flag: "wx" });
      try {
        linkSync(tmp, file);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Tệp tài khoản dev phải có mode 0600");
  const access = JSON.parse(readFileSync(file, "utf8"));
  for (const item of [access.database, access.owner?.password, access.guest?.password]) {
    if (!/^[a-f0-9]{64}$/.test(item)) throw new Error("Mật khẩu dev trong sổ cục bộ sai định dạng");
  }
  return access;
}

function localDocker() {
  const endpoint =
    process.env.DOCKER_HOST ||
    execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], {
      encoding: "utf8",
    }).trim();
  if (!endpoint.startsWith("unix:///")) throw new Error("Bản dev cần Docker daemon cục bộ qua Unix socket");
  const env = { ...process.env };
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "BUILDX_BUILDER",
    "BUILDKIT_HOST",
    "COMPOSE_FILE",
    "COMPOSE_PROFILES",
    "COMPOSE_ENV_FILES",
  ])
    delete env[key];
  return (args, extra = {}) =>
    execFileSync("docker", ["--host", endpoint, ...args], {
      env: { ...env, ...extra },
      stdio: ["ignore", "inherit", "inherit"],
    });
}

function compose(docker, access, file, image, ...args) {
  docker(["compose", "--env-file", "/dev/null", "-f", file, "-p", project(), ...args], {
    XT_PREVIEW_IMAGE: image,
    XT_PREVIEW_DB_PASSWORD: access.database,
    XT_DEMO_OWNER_PASSWORD: access.owner.password,
    XT_DEMO_GUEST_PASSWORD: access.guest.password,
  });
}

function stageImage(docker, state, digest) {
  const files = process.env.XT_DEPLOY_ARTIFACTS;
  if (files !== release) throw new Error(`web-api-ts cần đúng một artifact ${release}`);
  const staging = mkdtempSync(join(tmpdir(), "xt-preview-"));
  const archive = join(state, `${digest}.image.tar`);
  const pending = join(state, `${digest}.image.tmp`);
  try {
    copyFileSync(release, join(staging, "app.tgz"));
    if (subject(join(staging, "app.tgz")) !== digest) throw new Error("Artifact đã đổi sau khi tạo ứng viên");
    for (const file of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      `${cfg}/Dockerfile`,
      `${cfg}/compose.yaml`,
    ]) {
      const data = execFileSync("tar", ["-xOzf", join(staging, "app.tgz"), file], {
        maxBuffer: 64 * 1024 * 1024,
      });
      writeFileSync(join(staging, basename(file)), data);
    }
    docker(["build", "-t", imageTag(digest), "--build-arg", `XT_SUBJECT=${digest}`, staging]);
    docker(["image", "save", "-o", pending, imageTag(digest)]);
    copyFileSync(join(staging, "compose.yaml"), join(state, `${digest}.compose.tmp`));
    renameSync(join(state, `${digest}.compose.tmp`), join(state, `${digest}.compose.yaml`));
    renameSync(pending, archive);
  } finally {
    rmSync(pending, { force: true });
    rmSync(join(state, `${digest}.compose.tmp`), { force: true });
    rmSync(staging, { recursive: true, force: true });
  }
}

async function request(path, status, payload, token) {
  const options = {
    method: payload ? "POST" : "GET",
    headers: {},
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  };
  if (token) options.headers.authorization = `Bearer ${token}`;
  if (payload) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(url + path, options);
  if (response.status !== status) throw new Error(`${path}: HTTP ${response.status}, chờ ${status}`);
  return response.json();
}

async function observed() {
  const result = await request("/healthz", 200);
  if (result.status !== "ok") throw new Error("Ứng dụng chưa sẵn sàng");
  return validatedDigest(result.digest);
}

async function smoke(access) {
  await observed();
  const { token: owner } = await request("/v1/login", 200, access.owner);
  const { token: guest } = await request("/v1/login", 200, access.guest);
  if (!owner || !guest) throw new Error("Không có phiên dev");
  // Sản phẩm kiểm thử để ẩn (active: false) nên không lộ ra cửa hàng; chỉ chủ tenant thấy trong trang quản trị.
  const tag = randomBytes(8).toString("hex");
  const created = await request(
    "/v1/admin/products",
    201,
    { name: `Kiểm tra bản dev ${tag}`, slug: `smoke-${tag}`, brand: "Smoke", price: 1, active: false },
    owner,
  );
  if (typeof created.id !== "string" || created.slug !== `smoke-${tag}`)
    throw new Error("Sản phẩm sai sau khi tạo");
  const seen = async (token) =>
    (await request("/v1/admin/products", 200, null, token)).products.some((p) => p.id === created.id);
  if (!(await seen(owner))) throw new Error("Đọc lại sản phẩm thất bại");
  if (await seen(guest)) throw new Error("Tenant khác thấy được sản phẩm");
  await request("/v1/products", 200, null);
}

function currentSourceDigest() {
  const temp = mkdtempSync(join(tmpdir(), "xt-verify-"));
  try {
    execFileSync(process.execPath, ["scripts/build.ts", temp], { stdio: "pipe" });
    return subject(join(temp, "app.tgz"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function verify() {
  const ledger = JSON.parse(readFileSync("docs/ops/DEPLOYS.json", "utf8"));
  const entry = ledger.envs?.dev?.current;
  if (ledger.envs?.dev?.unknown !== false || entry?.result !== "deployed")
    throw new Error("Chưa có bản dev đã xác nhận");
  const expected = validatedDigest(entry.subject?.digest);
  if (currentSourceDigest() !== expected || (await observed()) !== expected) {
    throw new Error("Mã hiện tại, receipt và bản phục vụ chưa khớp nhau");
  }
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("text/html")) {
    throw new Error("Trang dùng thử chưa sẵn sàng");
  }
}

async function main(action) {
  if (process.env.XT_DEPLOY_ENV && process.env.XT_DEPLOY_ENV !== "dev")
    throw new Error("Adapter chỉ hỗ trợ dev");
  if (action === "candidate") {
    const expected = validatedDigest(process.env.XT_DEPLOY_DIGEST);
    if (subject(release) !== expected || currentSourceDigest() !== expected) {
      throw new Error("Artifact chưa khớp mã hiện tại. Chạy node scripts/build.ts và triển khai lại.");
    }
    return;
  }
  if (action === "digest") return console.log(await observed());
  if (action === "verify") return verify();
  const state = stateDirectory();
  if (action === "credentials") {
    const { owner, guest } = readAccess(state);
    return console.log(JSON.stringify({ owner, guest }));
  }
  if (action === "smoke") return smoke(readAccess(state));
  if (action === "stop")
    return compose(localDocker(), readAccess(state), `${cfg}/compose.yaml`, "xt-dev:local", "down");
  if (action !== "deploy" && action !== "rollback") throw new Error("Lệnh dev không hợp lệ");
  const rollback = action === "rollback";
  const digest = validatedDigest(rollback ? process.env.XT_DEPLOY_PREVIOUS : process.env.XT_DEPLOY_DIGEST);
  const docker = localDocker();
  const access = readAccess(state, !rollback);
  if (rollback) docker(["image", "load", "-i", join(state, `${digest}.image.tar`)]);
  else stageImage(docker, state, digest);
  compose(
    docker,
    access,
    join(state, `${digest}.compose.yaml`),
    imageTag(digest),
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "120",
    ...(rollback ? ["--pull", "never"] : []),
  );
}

main(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
