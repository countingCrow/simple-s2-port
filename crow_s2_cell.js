// Copyright 2019 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// - the clever though of S2 belongs to Google
// - most of this porting followed jonatkins port:
//   https://github.com/jonatkins/s2-geometry-javascript
// - original source of porting was from:
//   https://github.com/google/s2geometry/blob/master/src/s2/s2cell_id.cc
//   https://github.com/golang/geo/blob/master/s2/cellid.go
// - currently this port will only focus at convert between latLng
//   and Hilbert curve position for SQL search use.

(function (appendTo, appendName) {
  'use strict';
  const DEGREES_TO_RADIANS = Math.PI / 180.0;
  const RADIANS_TO_DEGREES = 180.0 / Math.PI;
  const LOOKUP_BITS = 4;
  const SWAP_MASK   = 0x01;
  const INVERT_MASK = 0x02;
  const SWAP_OR_INVERT_MASK = SWAP_MASK | INVERT_MASK;
  const MAX_LEVEL = 30;

  // lookup table
  let lookupIJ = new Array(1 << (2 * LOOKUP_BITS + 2));
  let lookupPos = new Array(1 << (2 * LOOKUP_BITS + 2));
  (function initLookupTable(lookupIJ, lookupPos) {
    // canonical order:    (0,0), (0,1), (1,1), (1,0)
    // axes swapped:       (0,0), (1,0), (1,1), (0,1)
    // bits inverted:      (1,1), (1,0), (0,0), (0,1)
    // swapped & inverted: (1,1), (0,1), (0,0), (1,0)
    const posToIJ = [
      [0, 1, 3, 2],
      [0, 2, 3, 1],
      [3, 2, 0, 1],
      [3, 1, 0, 2],
    ];
    const posToOrientation = [SWAP_MASK, 0, 0, SWAP_OR_INVERT_MASK];

    function initLookupCell(level, i, j, origOrientation, pos, orientation) {
      if (level == LOOKUP_BITS) {
        let ij = (i << LOOKUP_BITS) + j;
        lookupPos[(ij << 2) + origOrientation] = (pos << 2) + orientation;
        return ;
      }
      level++;
      i <<= 1;
      j <<= 1;
      pos <<= 2;
      let r = posToIJ[orientation];
      initLookupCell(level, i + (r[0] >> 1), j + (r[0] & 1), origOrientation, pos,     orientation ^ posToOrientation[0]);
      initLookupCell(level, i + (r[1] >> 1), j + (r[1] & 1), origOrientation, pos + 1, orientation ^ posToOrientation[1]);
      initLookupCell(level, i + (r[2] >> 1), j + (r[2] & 1), origOrientation, pos + 2, orientation ^ posToOrientation[2]);
      initLookupCell(level, i + (r[3] >> 1), j + (r[3] & 1), origOrientation, pos + 3, orientation ^ posToOrientation[3]);
    }

    initLookupCell(0, 0, 0, 0, 0, 0);
    initLookupCell(0, 0, 0, SWAP_MASK, 0, SWAP_MASK);
    initLookupCell(0, 0, 0, INVERT_MASK, 0, INVERT_MASK);
    initLookupCell(0, 0, 0, SWAP_OR_INVERT_MASK, 0, SWAP_OR_INVERT_MASK);
    // reverse
    lookupPos.forEach(function (value, index) {
      lookupIJ[value] = index;
    });
  })(lookupIJ, lookupPos);

  // https://stackoverflow.com/a/16155417
  function decimalToBinary(decimal, padding = 8){
    return (decimal >>> 0).toString(2).padStart(padding, '0');
  }

  // from (lat, lng) to (face, i, j):
  //  1. (lat, lng) to (x, y, z)
  function latLngToXyz(lat, lng) {
    let phi = lat * DEGREES_TO_RADIANS;
    let theta = lng * DEGREES_TO_RADIANS;
    let cosphi = Math.cos(phi);
    return [Math.cos(theta) * cosphi, Math.sin(theta) * cosphi, Math.sin(phi)];
  }
  //  2. (x, y, z) to (face, u, v)
  function xyzToFaceUv(xyz) {
    let face = largestAbsComponent(xyz);
    if (xyz[face] < 0) {
      face += 3;
    }
    return [face, faceXyzToUv(face, xyz)];
  }
  function largestAbsComponent([x, y, z]) {
    let temp = [Math.abs(x), Math.abs(y), Math.abs(z)];
    if (temp[0] > temp[1]) {
      return temp[0] > temp[2] ? 0 : 2;
    }
    return temp[1] > temp[2] ? 1 : 2;
  }
  function faceXyzToUv(face, [x, y, z]) {
    let u, v;
    switch (face) {
      case 0:
        u =  y / x;
        v =  z / x;
        break;
      case 1:
        u = -x / y;
        v =  z / y;
        break;
      case 2:
        u = -x / z;
        v = -y / z;
        break;
      case 3:
        u =  z / x;
        v =  y / x;
        break;
      case 4:
        u =  z / y;
        v = -x / y;
        break;
      case 5:
        u = -y / z;
        v = -x / z;
        break;
      default:
        throw new Error('invalid face');
        break;
    }
    return [u, v];
  }
  //  3. (face, u, v) to (face, s, t)
  function uVToST(u, v) {
    return [singleUvToSt(u), singleUvToSt(v)];
  }
  function singleUvToSt(uOrV) {
    if (uOrV >= 0) {
      return 0.5 * Math.sqrt(1 + 3 * uOrV);
    }
    return 1 - 0.5 * Math.sqrt(1 - 3 * uOrV);
  }
  //  4. (face, s, t) to (face, i, j)
  function sTLevelToIJ(s, t, level) {
    const maxSize = 1 << level;
    return [singleStToIj(s, maxSize), singleStToIj(t, maxSize)];
  }
  function singleStToIj(sOrT, maxSize) {
    let iOrJ = Math.floor(sOrT * maxSize);
    return Math.max(0, Math.min(maxSize - 1, iOrJ));
  }

  // from (face, i, j) to (lat, lng)
  //  1. (face, i, j) to (face, s, t)
  function iJLevelToSt(i, j, level, offsetI = 0.5, offsetJ = 0.5) {
    const maxSize = 1 << level;
    return [
      // offset 0.5 as center
      (i + offsetI) / maxSize,
      (j + offsetJ) / maxSize
    ];
  }
  //  2. (face, s, t) to (face, u, v)
  function sTToUv(s, t) {
    return [singleStToUv(s), singleStToUv(t)];
  }
  function singleStToUv(sOrT) {
    if (sOrT >= 0.5) {
      return (1 / 3.0) * (4 * sOrT * sOrT - 1);
    }
    return (1 / 3.0) * (1 - (4 * (1 - sOrT) * (1 - sOrT)));
  }
  //  3. (face, u, v) to (x, y, z)
  function faceUVToXyz(face, u, v) {
    switch (face) {
      case 0: return [ 1,  u,  v]; break;
      case 1: return [-u,  1,  v]; break;
      case 2: return [-u, -v,  1]; break;
      case 3: return [-1, -v, -u]; break;
      case 4: return [ v, -1, -u]; break;
      case 5: return [ v,  u, -1]; break;
      default: throw new Error('invalid face'); break;
    }
  }
  //  4. (x, y, z) to (lat, lng)
  function xYZToLatLng(x, y, z) {
    let lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RADIANS_TO_DEGREES;
    let lng = Math.atan2(y, x) * RADIANS_TO_DEGREES;
    return [lat, lng];
  }

  // (face, i, j) to (p1p2, p3p4p5p6, p7p8p9p10, ..., p27p28p29p30)
  function faceIJToPos(face, i, j) {
    const mask = (1 << LOOKUP_BITS) - 1;

    // 4 bits, 8 bits * 7
    let pos = new Array(8);
    // init with first orientation
    let bits = face & SWAP_MASK;
    // Each time we will map 4 bits of both i and j to Hilbert curve position:
    // lookup table will map iiiijjjjoo to ppppppppoo
    // (the resulting orientation would be used for next mapping)
    // https://github.com/google/s2geometry/blob/master/src/s2/s2cell_id.cc#L278
    for (let k = 7; k >= 0; k--) {
      bits += ((i >> (k * LOOKUP_BITS)) & mask) << (LOOKUP_BITS + 2);
      bits += ((j >> (k * LOOKUP_BITS)) & mask) << 2;
      bits = lookupPos[bits];
      pos[-(k - 7)] = bits >> 2;
      bits &= SWAP_OR_INVERT_MASK;
    }
    return pos;
  }
  function posLevelToBinaryString(pos, level) {
    // first one will only produce 4 bits
    let result = decimalToBinary(pos[0], 4)
      + decimalToBinary(pos[1])
      + decimalToBinary(pos[2])
      + decimalToBinary(pos[3])
      + decimalToBinary(pos[4])
      + decimalToBinary(pos[5])
      + decimalToBinary(pos[6])
      + decimalToBinary(pos[7])
      ;
    // remove zero
    return result.substring((MAX_LEVEL - level) * 2);
  }

  // reverse lookup to fetch i j from position binary
  function faceBinaryPosToIj(face, positionBinary) {
    face *= 1;
    if (isNaN(face) || face > 5 || face < 0) {
      throw new Error('invalid face');
    }
    if (!/^([01]{4})((?:[01]{8}){7})$/.test(positionBinary)) {
      throw new Error('invalid position');
    }
    let i = 0;
    let j = 0;
    let positionList = [RegExp.$1];
    positionList.push(...RegExp.$2.match(/[01]{8}/g));
    positionList = positionList.map(eachPosition => parseInt(eachPosition, 2));
    // try our way back..
    let firstOrientation = 0;
    while (firstOrientation < 4) {
      let orientation = firstOrientation;
      let possibleIjo = 0;
      i = 0;
      j = 0;
      for (let k = 7, l = 0; k >= 0; k--) {
        possibleIjo = lookupIJ[(positionList[k] << 2) + orientation];
        i += (possibleIjo >> (LOOKUP_BITS + 2)) << l;
        j += ((possibleIjo >> 2) & ((1 << LOOKUP_BITS) - 1)) << l;
        l += LOOKUP_BITS;
        orientation = possibleIjo & SWAP_OR_INVERT_MASK;
      }
      // should match start
      if (orientation === (face & SWAP_MASK)) {
        // first one should only give 4 bits
        if ((lookupPos[possibleIjo] >> (LOOKUP_BITS + 2)) === 0) {
          break;
        }
      }
      firstOrientation++;
    }
    if (firstOrientation > 3) {
      throw new Error('could not reverse back to i j');
    }
    return [i, j];
  }

  // reverse i j to lat lng
  function faceIJLevelOffsetToLatLng(face, i, j, level, offsetI = 0.5, offsetJ = 0.5) {
    let [s, t] = iJLevelToSt(i, j, level, offsetI, offsetJ);
    let [u, v] = sTToUv(s, t);
    let [x, y, z] = faceUVToXyz(face, u, v);
    let [lat, lng] = xYZToLatLng(x, y, z);
    // leaflet support
    if ('object' === typeof L) {
      return L.latLng(lat, lng);
    }
    return {
      lat: lat,
      lng: lng,
    };
  }

  class CrowS2CellId {
    // only face, i, j, level is granted after construct
    // possible init arg:
    //  - stander_string    : 1/22030333332200233030
    //  - fijl_string       : F1ij[885539,851769]@20
    //  - token             : 3467ff41799
    //  - mysql_token       : 122030333332200233030
    //  - lat, lng, level   : (24.935570, 121.69994, 20)
    //  - latlng, level     : ({lat:24.935570, lng:121.69994}, 20)
    //  - face, i, j, level : (1, 885539, 851769, 20)
    //  - face, ij, level   : (1, [885539, 851769], 20)
    constructor(...arg) {
      this.isLatLngCellCenter = false;
      // stander_string
      // fijl_string
      // token
      // mysql_token
      if (arg.length === 1) {
        // stander_string
        if (/^([0-5])\/([0-3]{1,30})$/.test(arg[0])) {
          this.initFromMysqlToken_(RegExp.$1, RegExp.$2);
        }
        // fijl_string
        else if (/^F([0-5])ij\[(\d+),(\d+)\]@(\d+)$/.test(arg[0])) {
          // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment#Assignment_without_declaration
          ({$1: this.face, $2: this.i, $3: this.j, $4: this.level} = RegExp);
        }
        // token
        else if (/^([2-9a-b][0-9a-f]{1,15})$/.test(arg[0])) {
          this.initFromToken_(RegExp.$1);
        }
        // mysql_token
        else if (/^([0-5])([0-3]{1,30})$/.test(arg[0])) {
          this.initFromMysqlToken_(RegExp.$1, RegExp.$2);
        }
        else {
          throw new Error('could not construct s2_cell');
        }
      }
      // latlng, level
      else if (arg.length === 2) {
        // [lat, lng], level
        if (Array.isArray(arg[0])) {
          [[this.lat, this.lng], this.level] = arg;
        }
        // {lat, lng}, level
        else if (typeof arg[0] === 'object') {
          [{lat: this.lat, lng: this.lng}, this.level] = arg;
        }
        else {
          throw new Error('invalid latlng');
        }
      }
      // lat, lng, level
      // face, ij, level
      else if (arg.length === 3) {
        // face, ij, level
        if (Array.isArray(arg[1])) {
          [this.face, [this.i, this.j], this.level] = arg;
        }
        // lat, lng, level
        else {
          [this.lat, this.lng, this.level] = arg;
        }
      }
      // face, i, j, level
      else if (arg.length === 4) {
        [this.face, this.i, this.j, this.level] = arg;
      }
      // error
      else {
        throw new Error('could not construct s2_cell');
      }
      // these SHOULD be numeric
      ['face', 'i', 'j', 'level', 'lat', 'lng'].forEach((propName) => {
        if (typeof this[propName] === 'string') {
          this[propName] *= 1;
        }
      });
      if (isNaN(this.level) || this.level > MAX_LEVEL || this.level < 1) {
        throw new Error('invalid level');
      }
      if (this.lat !== undefined && this.lng !== undefined) {
        this.initFromLatLng_();
      }
      else if (this.face !== undefined && this.i !== undefined && this.j !== undefined) {
        this.initFromFaceIJ_();
      }
    }

    initFromLatLng_() {
      [this.x, this.y, this.z] = latLngToXyz(this.lat, this.lng);
      [this.face, [this.u, this.v]] = xyzToFaceUv([this.x, this.y, this.z], this.level);
      [this.s, this.t] = uVToST(this.u, this.v);
      [this.i, this.j] = sTLevelToIJ(this.s, this.t, this.level);
    }
    initFromFaceIJ_() {
      // nothing to do, get latlng only when need(?)
    }
    initFromToken_(token) {
      let binaryCellId = '';
      for (let k = 0; k < token.length; k++) {
        binaryCellId += decimalToBinary(parseInt(token[k], 16), 4);
      }
      this.face = parseInt(binaryCellId.substring(0, 3), 2);
      if (isNaN(this.face) || this.face > 5 || this.face < 0) {
        throw new Error('invalid face');
      }
      this.level = (binaryCellId.length - 4) / 2;
      if (this.level > MAX_LEVEL || this.level < 1) {
        throw new Error('invalid level');
      }
      let binaryPos = binaryCellId
        .substring(3, binaryCellId.length - 1)
        .padStart(MAX_LEVEL * 2, '0')
        ;
      [this.i, this.j] = faceBinaryPosToIj(this.face, binaryPos);
    }
    initFromMysqlToken_(face, pos) {
      this.face = face * 1;
      this.level = pos.length;
      let binaryPos = ''.padStart((MAX_LEVEL - this.level) * 2, '0');
      for (let k = 0; k < this.level; k++) {
        binaryPos += decimalToBinary(pos[k], 2);
      }
      [this.i, this.j] = faceBinaryPosToIj(face, binaryPos);
    }

    getLatLng() {
      this.isLatLngCellCenter = true;
      return {lat: this.lat, lng: this.lng}
        = faceIJLevelOffsetToLatLng(this.face, this.i, this.j, this.level)
        ;
    }
    getCornerLatLng() {
      let result = [];
      for (let offsetI = 0; offsetI < 2; offsetI++) {
        for (let offsetJ = 0; offsetJ < 2; offsetJ++) {
          result.push(faceIJLevelOffsetToLatLng(this.face, this.i, this.j, this.level, offsetI, offsetJ));
        }
      }
      return result;
    }

    // fppp..pp
    // [0-5][0-3]{level}
    toMysqlToken() {
      return this.toString().replace('/', '');
    }
    toString(fijl = false) {
      // compatibility
      if (fijl) {
        return 'F' + this.face + 'ij[' + this.i + ',' + this.j + ']@' + this.level;
      }
      // ij should be correct from above, only swap when we need to get
      // position at odd level
      let [i, j] = (this.level % 2) ? [this.j, this.i] : [this.i, this.j];
      // /^[0-5]/[0-3]{level}$/
      let pos = faceIJToPos(this.face, i, j);
      let positionBinary = posLevelToBinaryString(pos, this.level);
      let tokenGroup = positionBinary.match(/.{1,2}/g);
      tokenGroup.forEach(function (value, index) {
        tokenGroup[index] = parseInt(value, 2);
      });
      return this.face + '/' + tokenGroup.join('');
    }
    toToken() {
      // ij should be correct from above, only swap when we need to get
      // position at odd level
      let [i, j] = (this.level % 2) ? [this.j, this.i] : [this.i, this.j];
      let pos = faceIJToPos(this.face, i, j);
      let positionBinary = posLevelToBinaryString(pos, this.level);
      // cap with face, tail with 1
      let tokenBinary = decimalToBinary(this.face, 3) + positionBinary + '1';
      // split to groups to prevent overflow
      let result = tokenBinary.match(/.{1,4}/g);
      result.forEach(function (value, index) {
        result[index] = parseInt(value, 2).toString(16);
      });
      return result.join('');
    }

  }

  appendTo[appendName] = CrowS2CellId;
})(window, 'CrowS2CellId');
