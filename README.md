# simple-s2-port
Simple Google S2 Geometry Porting. Aimed to convert between latLng and Hilbert curve position for SQL search use.

# usage
Put the javascript file where ever you want; Modify the arguments that passed into closure as you need.

To create object:
```javascript
// stander string
var myS2CellId = new CrowS2CellId('1/22030333332200233030');
// fijl string
var myS2CellId = new CrowS2CellId('F1ij[885539,851769]@20');
// token
var myS2CellId = new CrowS2CellId('3467ff41799');
// 'mysql_token'
var myS2CellId = new CrowS2CellId('122030333332200233030');
// lat, lng, level
var myS2CellId = new CrowS2CellId(24.935570, 121.69994, 20);
// latLng, level
var myS2CellId = new CrowS2CellId({lat:24.935570, lng:121.69994}, 20);
// face, i, j, level
var myS2CellId = new CrowS2CellId(1, 885539, 851769, 20);
// face, [i, j], level
var myS2CellId = new CrowS2CellId(1, [885539, 851769], 20);
```
Methods:
```javascript
// return latLng object
myS2CellId.getLatLng();
// return array of latLng object
myS2CellId.getCornerLatLng();
// stander toString result without slash, ex: '122030333332200233030'
myS2CellId.toMysqlToken();
// original source toString, ex: '1/22030333332200233030'
myS2CellId.toString();
// compatibility for jonatkins port toString, ex: 'F1ij[885539,851769]@20'
myS2CellId.toString(true);
// original source token, ex: '3467ff41799'
myS2CellId.toToken();
```

# links
+ original c++ source: https://github.com/google/s2geometry/blob/master/src/s2/s2cell_id.cc
+ original go source: https://github.com/golang/geo/blob/master/s2/cellid.go
+ jonatkins port: https://github.com/jonatkins/s2-geometry-javascript
+ s2geometry.io: https://s2geometry.io/devguide/s2cell_hierarchy.html
