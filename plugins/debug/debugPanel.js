/*
 * MelonJS Game Engine
 * Copyright (C) 2011 - 2014 Olivier Biot, Jason Oster, Aaron McLeod
 * http://www.melonjs.org
 *
 * a simple debug panel plugin
 * usage : me.plugin.register(debugPanel, "debug");
 *
 * you can then use me.plugin.debug.show() or me.plugin.debug.hide()
 * to show or hide the panel, or press respectively the "S" and "H" keys.
 *
 * note :
 * Heap Memory information is available under Chrome when using
 * the "--enable-memory-info" parameter to launch Chrome
 */

(function($) {

    // ensure that me.debug is defined
    me.debug = me.debug || {};

    var DEBUG_HEIGHT = 70;

    /**
     * @class
     * @public
     * @extends me.plugin.Base
     * @memberOf me
     * @constructor
     */
    debugPanel = me.plugin.Base.extend(
    /** @scope me.debug.Panel.prototype */
    {

        /** @private */
        init : function(showKey, hideKey) {
            // call the super constructor
            this._super(me.plugin.Base, 'init');

            // minimum melonJS version expected
            this.version = "1.1.0";

            // to hold the debug options
            // clickable rect area
            this.area = {};

            // panel position and size
            this.rect = null;

            // for z ordering
            // make it ridiculously high
            this.z = Infinity;

            // visibility flag
            this.visible = false;

            // frame update time in ms
            this.frameUpdateTime = 0;

            // frame draw time in ms
            this.frameDrawTime = 0;

            this.rect = new me.Rect(0, 0, me.video.renderer.getWidth(), DEBUG_HEIGHT);

            // set the object GUID value
            this.GUID = "debug-" + me.utils.createGUID();

            // set the object entity name
            this.name = "me.debugPanel";

            // persistent
            this.isPersistent = true;

            // a floating object
            this.floating = true;

            // renderable
            this.isRenderable = true;

            // always update, even when not visible
            this.alwaysUpdate = true;
            var screenCanvas = me.video.renderer.getScreenCanvas();
            this.canvas = me.video.createCanvas(screenCanvas.width, DEBUG_HEIGHT, true);
            
            screenCanvas.parentNode.appendChild(this.canvas);
            this.canvas.style.position = 'absolute';
            this.canvas.style.opacity = '0.7';
            this.canvas.style.top = '0px';
            this.canvas.style.left = '0px';
            this.canvas.parentNode.position = 'relative';
            this.context = me.CanvasRenderer.getContext2d(this.canvas);

            // create a default font, with fixed char width
            var s = 10;
            this.mod = 1;
            if(me.game.viewport.width < 500) {
                s = 7;
                this.mod = 0.7;
            }
            s *= me.device.getPixelRatio();
            this.mod *= me.device.getPixelRatio();
            this.font = new me.Font('courier', s, 'white');

            // clickable areas
            this.area.renderHitBox = new me.Rect(160,5,15,15);
            this.area.renderVelocity = new me.Rect(165,18,15,15);

            this.area.renderQuadTree = new me.Rect(270,5,15,15);
            this.area.renderCollisionMap = new me.Rect(270,18,15,15);

            // some internal string/length
            this.help_str      = "(s)how/(h)ide";
            this.help_str_len = this.font.measureText(me.video.renderer.getSystemContext(), this.help_str).width;
            this.fps_str_len = this.font.measureText(me.video.renderer.getSystemContext(), "00/00 fps").width;
            this.memoryPositionX = this.font.measureText(me.video.renderer.getSystemContext(), "Draw   : ").width * 2.2 + 300 * this.mod;

            // enable the FPS counter
            me.debug.displayFPS = true;

            // bind the "S" and "H" keys
            me.input.bindKey(showKey || me.input.KEY.S, "show", false, false);
            me.input.bindKey(hideKey || me.input.KEY.H, "hide", false, false);

            // add some keyboard shortcuts
            var self = this;
            this.keyHandler = me.event.subscribe(me.event.KEYDOWN, function (action, keyCode, edge) {
                if (action === "show") {
                    self.show();
                } else if (action === "hide") {
                    self.hide();
                }
            });

            // re-apply panel settings on level changes
            this.levelHandler = me.event.subscribe(me.event.LEVEL_LOADED, function () {
                var layer = me.game.currentLevel.getLayerByName("collision");
                if (layer) {
                    layer.setOpacity((me.debug.renderCollisionMap===true)?1:0);
                }
            });

            // memory heap sample points
            this.samples = [];

            //patch patch patch !
            this.patchSystemFn();
            me.video.onresize(null);
            // make it visible
            this.show();
        },


        /**
         * patch system fn to draw debug information
         */
        patchSystemFn : function() {

            // add a few new debug flag (if not yet defined)
            me.debug.renderHitBox = me.debug.renderHitBox || false;
            me.debug.renderVelocity = me.debug.renderVelocity || false;
            me.debug.renderCollisionMap = me.debug.renderCollisionMap || false;
            me.debug.renderQuadTree = me.debug.renderQuadTree || false;
            
            var _this = this;
            
            // patch timer.js
            me.plugin.patch(me.timer, "update", function (time) {
                // call the original me.timer.update function
                this._patched(time);

                // call the FPS counter
                me.timer.countFPS();
            });

            // patch me.game.update
            me.plugin.patch(me.game, 'update', function(time) {
                var frameUpdateStartTime = window.performance.now();

                this._patched(time);

                // calculate the update time
                _this.frameUpdateTime = window.performance.now() - frameUpdateStartTime;
            });

            // patch me.game.draw
            me.plugin.patch(me.game, 'draw', function() {
                var frameDrawStartTime = window.performance.now();

                this._patched();

                // calculate the drawing time
                _this.frameDrawTime = window.performance.now() - frameDrawStartTime;
            });

            // patch sprite.js
            me.plugin.patch(me.Sprite, "draw", function (renderer) {
                // call the original me.Sprite function
                this._patched(renderer);

                // draw the sprite rectangle
                if (me.debug.renderHitBox) {
                    renderer.strokeRect(this.left, this.top, this.width, this.height, "green");
                }
            });

            // patch entities.js
            me.plugin.patch(me.Entity, "draw", function (renderer) {
                // call the original me.game.draw function
                this._patched(renderer);

                // check if debug mode is enabled

                if (me.debug.renderHitBox) {
                    renderer.save();
                    // draw the bounding rect shape
                    this.body.getBounds().draw(renderer, "orange");
                    renderer.translate(this.pos.x, this.pos.y);
                    if (this.body.shapes.length) {
                        // TODO : support multiple shapes
                        this.body.shapes[0].draw(renderer, "red");
                    }
                    renderer.restore();
                }

                if (me.debug.renderVelocity) {
                    // draw entity current velocity
                    var x = ~~(this.pos.x + this.hWidth);
                    var y = ~~(this.pos.y + this.hHeight);
                    // TODO: This will also be tricky for WebGL.
                    var context = renderer.getContext();
                    context.strokeStyle = "blue";
                    context.lineWidth = 1;
                    context.beginPath();
                    context.moveTo(x, y);
                    context.lineTo(
                        x + ~~(this.body.vel.x * this.hWidth),
                        y + ~~(this.body.vel.y * this.hHeight)
                    );
                    context.stroke();
                }
            });

            // resize event to resize our canvas
            me.plugin.patch(me.video, "updateDisplaySize", function (scaleX, scaleY) {
                this._patched(scaleX, scaleY);

                var canvas = me.video.renderer.getScreenCanvas();
                _this.canvas.width = canvas.width;
                _this.canvas.height = DEBUG_HEIGHT;
                _this.canvas.style.top = (-parseInt(canvas.style.height)) + "px";
                _this.canvas.style.width = canvas.style.width;
                _this.canvas.style.height = DEBUG_HEIGHT * scaleY;
                _this.rect.resize(canvas.width, DEBUG_HEIGHT * scaleY);
            });
        },

        /**
         * show the debug panel
         */
        show : function() {
            if (!this.visible) {
                // register a mouse event for the checkboxes
                // me.input.registerPointerEvent('pointerdown', this.rect, this.onClick.bind(this), true);
                this.canvas.addEventListener('click', this.onClick.bind(this));
                // add the debug panel to the game world
                me.game.world.addChild(this, Infinity);
                // mark it as visible
                this.visible = true;
            }
        },

        /**
         * hide the debug panel
         */
        hide : function() {
            if (this.visible) {
                // release the mouse event for the checkboxes
                // me.input.releasePointerEvent('pointerdown', this.rect);
                this.canvas.removeEventListener('click', this.onClick.bind(this));
                // remove the debug panel from the game world
                me.game.world.removeChild(this);
                // mark it as invisible
                this.visible = false;
            }
        },


        /** @private */
        update : function() {
            if (me.input.isKeyPressed('show')) {
                this.show();
            }
            else if (me.input.isKeyPressed('hide')) {
                this.hide();
            }
            return true;
        },

        /**
         * @private
         */
        getBounds : function() {
            return this.rect;
        },

        /** @private */
        onClick : function(e)  {
            // check the clickable areas
            if (this.area.renderHitBox.containsPoint(e.clientX, e.clientY)) {
                me.debug.renderHitBox = !me.debug.renderHitBox;
            }
            else if (this.area.renderCollisionMap.containsPoint(e.clientX, e.clientY)) {
                var layer = me.game.currentLevel.getLayerByName("collision");
                if (layer) {
                    if (layer.getOpacity() === 0) {
                        layer.setOpacity(1);
                        me.debug.renderCollisionMap = true;
                    } else {
                        layer.setOpacity(0);
                        me.debug.renderCollisionMap = false;
                    }
                }
            } 
            else if (this.area.renderVelocity.containsPoint(e.clientX, e.clientY)) {
                // does nothing for now, since velocity is
                // rendered together with hitboxes (is a global debug flag required?)
                me.debug.renderVelocity = !me.debug.renderVelocity;
            } 
            else if (this.area.renderQuadTree.containsPoint(e.clientX, e.clientY)) {
                me.debug.renderQuadTree = !me.debug.renderQuadTree;
            }
            // force repaint
            me.game.repaint();
        },

        /** @private */        
        drawQuadTreeNode : function (renderer, node) {
            var bounds = node._bounds;
            
            // Opacity is based on number of objects in the cell
            renderer.setGlobalAlpha((node.children.length / 16).clamp(0, 0.9));
            renderer.fillRect(Math.abs(bounds.pos.x) + 0.5,
                Math.abs(bounds.pos.y) + 0.5,
                bounds.width,
                bounds.height,
                "red"
            );

            var len = node.nodes.length;

            for(var i = 0; i < len; i++) {
                this.drawQuadTreeNode(renderer, node.nodes[i]);
            }
        },
        
        /** @private */
        drawQuadTree : function (renderer) {
            // save the current globalAlpha value
            var _alpha = renderer.globalAlpha();
            
            renderer.translate(-me.game.viewport.pos.x, -me.game.viewport.pos.y);
            
            this.drawQuadTreeNode(renderer, me.collision.quadTree.root);
            
            renderer.translate(me.game.viewport.pos.x, me.game.viewport.pos.y);
            
            renderer.setGlobalAlpha(_alpha);
        },

        /** @private */
        drawMemoryGraph : function (context, endX) {
            if (window.performance && window.performance.memory) {
                var usedHeap  = Number.prototype.round(window.performance.memory.usedJSHeapSize/1048576, 2);
                var totalHeap =  Number.prototype.round(window.performance.memory.totalJSHeapSize/1048576, 2);
                var len = endX - this.memoryPositionX;

                // remove the first item
                this.samples.shift();
                // add a new sample (25 is the height of the graph)
                this.samples[len] = (usedHeap / totalHeap)  * 25;

                // draw the graph
                for (var x = len; x >= 0; x--) {
                    var where = endX - (len - x);
                    context.beginPath();
                    context.strokeStyle = "lightblue";
                    context.moveTo(where, 30 * this.mod);
                    context.lineTo(where, (30 - (this.samples[x] || 0)) * this.mod);
                    context.stroke();
                }
                // display the current value
                this.font.drawFromContext(context, "Heap : " + usedHeap + '/' + totalHeap + ' MB', this.memoryPositionX, 5 * this.mod);
            } else {
                // Heap Memory information not available
                this.font.drawFromContext(context, "Heap : ??/?? MB", this.memoryPositionX, 5 * this.mod);
            }
        },

        /** @private */
        draw : function(renderer) {
            this.context.save();
            
            // draw the QuadTree (before the panel)
            if (me.debug.renderQuadTree === true) {
                this.drawQuadTree(renderer);
            }

            // draw the panel
            this.context.globalAlpha = 0.5;
            this.context.fillRect(this.rect.left,  this.rect.top,
                             this.rect.width, this.rect.height, "black");
            this.context.globalAlpha = 1.0;

            // # entities / draw
            this.font.drawFromContext(this.context, "#objects : " + me.game.world.children.length, 5 * this.mod, 5 * this.mod);
            this.font.drawFromContext(this.context, "#draws   : " + me.game.world.drawCount, 5 * this.mod, 15 * this.mod);

            // debug checkboxes
            this.font.drawFromContext(this.context, "?hitbox   ["+ (me.debug.renderHitBox?"x":" ") +"]",     85 * this.mod, 5 * this.mod);
            this.font.drawFromContext(this.context, "?velocity ["+ (me.debug.renderVelocity?"x":" ") +"]",     85 * this.mod, 15 * this.mod);

            this.font.drawFromContext(this.context, "?QuadTree   ["+ (me.debug.renderQuadTree?"x":" ") +"]",    175 * this.mod, 5 * this.mod);
            this.font.drawFromContext(this.context, "?col. layer ["+ (me.debug.renderCollisionMap?"x":" ") +"]", 175 * this.mod, 15 * this.mod);

            // draw the update duration
            this.font.drawFromContext(this.context, "Update : " + this.frameUpdateTime.toFixed(2) + " ms", 285 * this.mod, 5 * this.mod);
            // draw the draw duration
            this.font.drawFromContext(this.context, "Draw   : " + (this.frameDrawTime).toFixed(2) + " ms", 285 * this.mod, 15 * this.mod);

            // draw the memory heap usage
            var endX = this.rect.width - 25;
            this.drawMemoryGraph(this.context, endX - this.help_str_len);

            // some help string
            this.font.drawFromContext(this.context, this.help_str, endX - this.help_str_len, 15 * this.mod);

            //fps counter
            var fps_str = "" + me.timer.fps + "/"    + me.sys.fps + " fps";
            this.font.drawFromContext(this.context, fps_str, this.rect.width - this.fps_str_len - 5, 5 * this.mod);

            this.context.restore();

        },

        /** @private */
        onDestroyEvent : function() {
            // hide the panel
            this.hide();
            // unbind keys event
            me.input.unbindKey(me.input.KEY.S);
            me.input.unbindKey(me.input.KEY.H);
            me.event.unsubscribe(this.keyHandler);
            me.event.unsubscribe(this.levelHandler);
        }


    });

    /*---------------------------------------------------------*/
    // END END END
    /*---------------------------------------------------------*/
})(window);
