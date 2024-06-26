/**
 * @PACKAGE_INFO
 * An webpack plugin that helps to create sprite image
 * and generate manifest.json file contains coordinate 
 * of each image in sprite
 */

const Spritesmith = require("spritesmith");
const path = require("path");
const { existsSync, lstatSync, writeFile: fsWriteFile, mkdirSync } = require("fs"); 
const util = require("util");

const writeFile = util.promisify(fsWriteFile)
const NAMESPACE = "SPRITE_PNG_PLUGIN";

/**
 * @_DEV_REFERENCE
 *  - Compiler docs: https://webpack.js.org/api/compiler-hooks
 *  - Compilation docs: https://webpack.js.org/api/compilation-hooks/
 *  - SpriteSmith: https://github.com/twolfson/spritesmith
 *  - Refer: https://github.com/naver/image-sprite-webpack-plugin
 *  - Usage webpack-virtual-modules: https://github.com/sysgears/webpack-virtual-modules/blob/master/examples/swagger-webpack4/webpack.config.js
 */

module.exports = class SpritePNG_Plugin {
  #cwd
  #spriteImagePath
  #manifestPath

  /**
   * @OPTION
   *  - outputDir: sprite data output directory 
   *  - entry: plugin will collect and watch all file in there
   *  - excludes: ignore these files
   */

  constructor(option) {
    this.#cwd             = process.cwd();
    this._outputDir       = this.#getOutputDir(option.outputDir);
    this._excludes        = option.excludes; // Reg and Reg Array are allowed
    this._entryPath       = this.#getEntry(option.entry);
    this.#spriteImagePath = path.join(this._outputDir, "sprite.png");
    this.#manifestPath    = path.join(this._outputDir, "manifest.json");
  }

  #getOutputDir(outputDir = "./") {
    const _outputDir = path.join(this.#cwd, outputDir);
    if (!existsSync(_outputDir) || !lstatSync(_outputDir).isDirectory()) {
      mkdirSync(_outputDir)
    }
    return _outputDir;
  }

  #getEntry(entry) {
    if (!entry) return [];
    if (!Array.isArray(entry)) entry = [entry];
    return entry;
  }

  #createSpriteSheet(imagesData, callback) {
    Spritesmith.run({
      src: imagesData
    }, (err, result) => {
      if (err) throw err;
      callback(result);
    });
  }

  #notExcludes(filePath) {
    if (!this._excludes) return true;
    const isRegExp = this._excludes instanceof RegExp;
    const isArr = Array.isArray(this._excludes);

    if (!(isRegExp || isArr)) throw Error(`"excludes" can be "RegExp" or "RegExp Array" only but received "${typeof this._excludes}"`);

    const posixPath = this.#convert2Posix(filePath);
    
    if (isRegExp) return !this._excludes.test(posixPath);
    if (isArr) {
      for (let idx = 0; idx < this._excludes.length; idx++) {
        const it = this._excludes[idx];
        if (!(it instanceof RegExp)) throw Error(`Item at ${idx} must be "RegExp" but received "${typeof it}"`);
        if (it.test(posixPath)) return false;
      }
    }
    return true;
  }

  #convert2Posix(v) {
    return v ? v.split(path.sep).join(path.posix.sep) : ''
  }

  #generateSpriteSheet(sources, callback) {
    this.#createSpriteSheet(sources, ({ coordinates, properties, image }) => {
      let metadata = {};
      Object.keys(coordinates).forEach(filePath => {
        const fileName = `${path.dirname(filePath).split(path.sep).pop()}_${path.basename(filePath)}`;
        metadata[fileName] = {
          x: coordinates[filePath].x,
          y: coordinates[filePath].y,
          w: coordinates[filePath].width,
          h: coordinates[filePath].height
        }
      })
      if (callback) {
        Promise.all([ 
          writeFile(this.#manifestPath, JSON.stringify(metadata), "utf8"),
          writeFile(this.#spriteImagePath, image, "binary")
        ]).finally(callback);
      } else {
        writeFile(this.#manifestPath, JSON.stringify(metadata), "utf8"),
        writeFile(this.#spriteImagePath, image, "binary")
      }
    });
  }

  #spriteProcess(watcher) {
    if (!watcher) throw Error('Watcher is not initialed');
    const sourceImagesByFolder = watcher.watched();
    const allSourceImages = Object.values(sourceImagesByFolder)
                              .flatMap(v => v.filter(p => this.#notExcludes(p) && this.#isPng(p)));
    if (allSourceImages?.length > 0) {  
      this.#generateSpriteSheet(allSourceImages);
    };
  }

  #pathEqual(path1, path2) {
    return path.relative(path1, path2) == '';
  }

  #isPng(filePath) {
    return filePath?.endsWith(".png")
  }

  apply(compiler) {
    const isProd = compiler.options.mode === "production";
    const scanner = isProd ? require("glob").globSync : require("gaze").Gaze;
    
    if (isProd) {
      compiler.hooks.beforeRun.tapAsync(NAMESPACE, (_, callback) => {
        const allSourceImages = scanner(this._entryPath, { ignore: "node_modules/**", cwd: this.#cwd })
                .map(v => path.join(this.#cwd, v))
                .filter(p => this.#notExcludes(p) && this.#isPng(p))
        if (allSourceImages.length > 0) this.#generateSpriteSheet(allSourceImages, callback);
      })
    } else {
      const gazeIns = new scanner(this._entryPath, { cwd: this.#cwd, mode: "watch", debounceDelay: 400 });
      gazeIns.on("ready", this.#spriteProcess.bind(this, gazeIns));
      // Listening files changed
      gazeIns.on("all", (event, filePath) => {
        if (
          event !== "renamed" && 
          this.#notExcludes(filePath) && 
          !this.#pathEqual(filePath, this.#spriteImagePath) && 
          !this.#pathEqual(filePath, this.#manifestPath) && 
          this.#isPng(filePath)
        ) {
          this.#spriteProcess(gazeIns);
        }
      });
    }
  }
}