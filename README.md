# simple-s2-port
Simple Google S2 Geometry Porting. Aimed to convert between latLng and Hilbert curve position for SQL search use.

# usage
Put the javascript file where ever you want; Modify the arguments that passed into closure as you need.

To create object:
```javascript
// stander string
var myS2Cell = new CrowS2Cell('1/22030333332200233030');
// fijl string
var myS2Cell = new CrowS2Cell('F1ij[885539,851769]@20');
// token
var myS2Cell = new CrowS2Cell('3467ff41799');
// 'mysql_token'
var myS2Cell = new CrowS2Cell('122030333332200233030');
// lat, lng, level
var myS2Cell = new CrowS2Cell(24.935570, 121.69994, 20);
// latLng, level
var myS2Cell = new CrowS2Cell({lat:24.935570, lng:121.69994}, 20);
// face, i, j, level
var myS2Cell = new CrowS2Cell(1, 885539, 851769, 20);
// face, [i, j], level
var myS2Cell = new CrowS2Cell(1, [885539, 851769], 20);
```
Methods:
```javascript
// return latLng object
myS2Cell.getLatLng();
// return array of latLng object
myS2Cell.getCornerLatLng();
// stander toString result without slash, ex: '122030333332200233030'
myS2Cell.toMysqlToken();
// original source toString, ex: '1/22030333332200233030'
myS2Cell.toString();
// compatibility for jonatkins port toString, ex: 'F1ij[885539,851769]@20'
myS2Cell.toString(true);
// original source token, ex: '3467ff41799'
myS2Cell.toToken();
```

# links
+ jonatkins port: https://github.com/jonatkins/s2-geometry-javascript
+ original c++ source: https://github.com/google/s2geometry/blob/master/src/s2/s2cell_id.cc
+ original go source: https://github.com/golang/geo/blob/master/s2/cellid.go
