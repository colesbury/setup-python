import * as path from 'path';
import * as exec from '@actions/exec';
import fs from 'fs';
import {
  IS_WINDOWS,
} from './utils';

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import { pythonVersionToSemantic, desugarDevVersion } from './find-python';
import * as os from 'os'
import * as crypto from 'crypto'


interface InstalledVersion {
  impl: string;
  version: string;
}

const MANIFEST : tc.IToolRelease[] = [
  {
    "version": "3.9.10",
    "stable": false,
    "release_url": "https://github.com/colesbury/nogil/releases/tag/v3.9.10-nogil-2022-12-21",
    "files": [
      {
        "filename": "python-3.9.10-amd64.exe",
        "arch": "x64",
        "platform": "win32",
        "download_url": "https://github.com/colesbury/nogil/releases/download/v3.9.10-nogil-2022-12-21/python-3.9.10-amd64.exe"
      },
      {
        "filename": "python-3.9.10-nogil-macos.tar.gz",
        "arch": "x64",
        "platform": "darwin",
        "download_url": "https://github.com/colesbury/nogil/releases/download/v3.9.10-nogil-2022-12-21/python-3.9.10-nogil-macos.tar.gz"
      },
    ]
  },
];

export async function findNogilVersion(
  version: string,
  architecture: string,
  updateEnvironment: boolean
): Promise<InstalledVersion> {

  // remove "nogil" prefix
  version = version.replace(/^nogil[\-]?/, "");

  const desugaredVersionSpec = desugarDevVersion(version);
  const semanticVersionSpec = pythonVersionToSemantic(desugaredVersionSpec);
  core.debug(`Semantic version spec of ${version} is ${semanticVersionSpec}`);

  const releaseData = await tc.findFromManifest(
    semanticVersionSpec,
    false,
    MANIFEST,
    architecture);

  if (!releaseData) {
    throw new Error(`Version ${version} with arch ${architecture} not found`);
  }

  const release = await installNogil(releaseData);
  const installDir = release.installDir;

  const pipDir = IS_WINDOWS ? 'Scripts' : 'bin';
  const _binDir = path.join(installDir, pipDir);
  const binaryExtension = IS_WINDOWS ? '.exe' : '';
  const pythonPath = path.join(
    IS_WINDOWS ? installDir : _binDir,
    `python${binaryExtension}`
  );
  const pythonLocation = IS_WINDOWS ? installDir : _binDir;
  if (updateEnvironment) {
    core.exportVariable('pythonLocation', installDir);
    // https://cmake.org/cmake/help/latest/module/FindPython.html#module:FindPython
    core.exportVariable('Python_ROOT_DIR', installDir);
    // https://cmake.org/cmake/help/latest/module/FindPython2.html#module:FindPython2
    core.exportVariable('Python2_ROOT_DIR', installDir);
    // https://cmake.org/cmake/help/latest/module/FindPython3.html#module:FindPython3
    core.exportVariable('Python3_ROOT_DIR', installDir);
    core.exportVariable('PKG_CONFIG_PATH', pythonLocation + '/lib/pkgconfig');
    core.addPath(pythonLocation);
    core.addPath(_binDir);
  }
  core.setOutput('python-version', `nogil-${releaseData.version}`);
  core.setOutput('python-path', pythonPath);

  return {impl: 'nogil', version: releaseData.version};
}

function sha256(data: string) {
    return crypto.createHash("sha256").update(data, "binary").digest("base64");
}

async function installNogil(releaseSpec: tc.IToolRelease) {
  const downloadUrl = releaseSpec.files[0].download_url;

  var dest = undefined;
  if (IS_WINDOWS) {
    const filename = path.basename(new URL(downloadUrl).pathname);
    dest = path.join(process.env['RUNNER_TEMP'] || "", filename);
  }

  const installDir = path.join(os.homedir(), `nogil-${releaseSpec.version}`);
  const cacheKey = `colesbury/setup-python-${process.env['RUNNER_OS']}-nogil-${releaseSpec.version}-${sha256(downloadUrl)}`;
  const cachePath = await cache.restoreCache([installDir], cacheKey);
  if (cachePath) {
    return { installDir };
  }

  core.info(`Downloading nogil from "${downloadUrl}" ...`);
  const nogilPath = await tc.downloadTool(downloadUrl, dest);

  if (IS_WINDOWS) {
    core.info('Installing downloaded exe...');
    const exitCode = await exec.exec(nogilPath, ['/passive', `TargetDir=${installDir}`]);
    if (exitCode !== 0) {
      throw new Error(`Failed to install nogil`);
    }
  } else {
    const nogilPath = await tc.downloadTool(downloadUrl);

    core.info('Extracting downloaded archive...');
    const downloadDir = await tc.extractTar(nogilPath);
    const archiveName = fs.readdirSync(downloadDir)[0];

    fs.renameSync(path.join(downloadDir, archiveName), installDir);
  }

  await cache.saveCache([installDir], cacheKey);

  return {installDir};
}