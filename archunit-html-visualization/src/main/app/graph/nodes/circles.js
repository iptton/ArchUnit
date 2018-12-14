'use strict';

const {Vector, vectors} = require('../infrastructure/vectors');

// FIXME: This inheritance looks like a 'I wanna share some fields' type of thing?? In which universe is a circle a special type of vector??
const Circle = class extends Vector {
  constructor(x, y, r) {
    super(x, y);
    this.r = r;
  }

  containsRelativeCircle(relativeCircle, padding = 0) {
    return relativeCircle.length() + relativeCircle.r + padding <= this.r;
  }

  /**
   * Takes an enclosing circle radius and a translation vector with respect to this circle.
   * Calculates the x- and y- coordinate for a maximal translation of this circle,
   * keeping this circle fully enclosed within the outer circle (whose position is (0,0)).
   *
   * @param enclosingCircleRadius radius of the outer circle
   * @param translationVector translation vector to be applied to this circle
   * @return this circle after translation, with respect to the enclosing circle's center.
   * Keeps this circle enclosed within the outer circle.
   */
  translateWithinEnclosingCircleAsFarAsPossibleInTheDirection(enclosingCircleRadius, translationVector) {
    const c1 = translationVector.x * translationVector.x + translationVector.y * translationVector.y;
    const c2 = Math.pow(enclosingCircleRadius - this.r, 2);
    const c3 = -Math.pow(this.y * translationVector.x - this.x * translationVector.y, 2);
    const c4 = -(this.x * translationVector.x + this.y * translationVector.y);
    const scale = (c4 + Math.sqrt(c3 + c2 * c1)) / c1;
    return this.changeTo({
      x: Math.trunc(this.x + scale * translationVector.x),
      y: Math.trunc(this.y + scale * translationVector.y)
    });
  }

  /**
   * Shifts this circle towards to the center of the parent circle (which is (0, 0)), so that this circle
   * is completely within the enclosing circle
   * @param enclosingCircleRadius radius of the outer circle
   * @param circlePadding minimum distance from inner circles outer circle borders
   * @return this circle after the shift into the enclosing circle
   */
  translateIntoEnclosingCircleOfRadius(enclosingCircleRadius, circlePadding) {
    return this.norm(enclosingCircleRadius - this.r - circlePadding);
  }

  static from(vector, r) {
    return new Circle(vector.x, vector.y, r);
  }
};

const FixableCircle = class extends Circle {
  constructor(x, y, r, id) {
    super(x, y, r);
    this.id = id;
    this._fixed = false;
  }

  isFixed() {
    return this._fixed;
  }

  getPositionRelativeTo(parentPosition) {
    return Vector.from(this).sub(parentPosition);
  }

  update(relativePosition, parentPosition) {
    this.changeTo(relativePosition).add(parentPosition);
    this._updateFixPosition();
  }

  fix() {
    this._fixed = true;
    this._updateFixPosition();
  }

  unfix() {
    this._fixed = false;
    this.fx = undefined;
    this.fy = undefined;
  }

  _updateFixPosition() {
    if (this._fixed) {
      this.fx = this.x;
      this.fy = this.y;
    }
  }
};

const ZeroCircle = class extends FixableCircle {
  constructor(id) {
    super(0, 0, 0, id);
  }

  containsRelativeCircle() {
    return true;
  }
};

//TODO: Maybe create RootCircle for avoiding case distinction
const NodeCircle = class {
  constructor(node, listener, absoluteReferenceCircle, x = 0, y = 0, r = 0) {
    this._node = node;
    this.relativePosition = new Vector(x, y);
    this.absoluteCircle = new FixableCircle(x, y, r, this._node.getFullName());
    this.absoluteReferenceCircle = absoluteReferenceCircle;
    this._listener = listener;
  }

  getRadius() {
    return this.absoluteCircle.r;
  }

  changeRadius(r) {
    this.absoluteCircle.r = r;
    const promise = this._node.isRoot() ? this.moveToPosition(r, r) : Promise.resolve(); // Shift root to the middle
    const listenerPromise = this._listener.onRadiusChanged();
    return Promise.all([promise, listenerPromise]);
  }

  expandRadius(r, padding) {
    this.absoluteCircle.r = r + padding;
    if (!this.absoluteReferenceCircle.containsRelativeCircle(Circle.from(this.relativePosition, this.getRadius()))) {
      this._node.getParent().nodeCircle.expandRadius(this.relativePosition.length() + this.getRadius(), padding);
    }
    if (this._node.isRoot()) {
      this.jumpToPosition(this.absoluteCircle.r, this.absoluteCircle.r, padding);
    }
    this._listener.onRadiusSet();
  }

  jumpToRelativeDisplacement(dx, dy, padding) {
    const directionVector = new Vector(dx, dy);
    const position = vectors.add(this.relativePosition, directionVector);
    this.jumpToPosition(position.x, position.y, padding);
  }

  jumpToPosition(x, y, padding) {
    const newRelativeCircle = Circle.from(new Vector(x, y), this.getRadius());
    if (!this._node.isRoot() && !this.absoluteReferenceCircle.containsRelativeCircle(newRelativeCircle)) {
      this._node.getParent().nodeCircle.expandRadius(newRelativeCircle.length() + newRelativeCircle.r, padding);
    }
    this.relativePosition.changeTo(newRelativeCircle);
    this._updateAbsolutePositionAndDescendants();
    this._listener.onJumpedToPosition();
    this._listener.onRimPositionChanged();
  }

  _updateAbsolutePosition() {
    this.absoluteCircle.update(this.relativePosition, this.absoluteReferenceCircle);
  }

  _updateAbsolutePositionAndDescendants() {
    this._updateAbsolutePosition();
    this._node.getCurrentChildren().forEach(child => child.nodeCircle._updateAbsolutePositionAndDescendants());
  }

  _updateAbsolutePositionAndChildren() {
    this._updateAbsolutePosition();
    this._node.getCurrentChildren().forEach(child => child.nodeCircle._updateAbsolutePosition());
  }

  startMoveToIntermediatePosition() {
    if (!this.absoluteCircle.isFixed()) {
      return this._listener.onMovedToIntermediatePosition();
    }
    return Promise.resolve();
  }

  //TODO: remove return value
  completeMoveToIntermediatePosition() {
    this._updateAbsolutePositionAndChildren();
    if (!this.absoluteCircle.isFixed()) {
      this.absoluteCircle.fix();
      return this._listener.onMovedToPosition();
    }
    return Promise.resolve();
  }

  moveToPosition(x, y) {
    this.relativePosition.changeTo(new Vector(x, y));
    return this.completeMoveToIntermediatePosition();
  }

  takeAbsolutePosition(circlePadding) {
    const newRelativePosition = this.absoluteCircle.getPositionRelativeTo(this.absoluteReferenceCircle);
    const newRelativeCircle = Circle.from(newRelativePosition, this.getRadius());
    if (!this.absoluteReferenceCircle.containsRelativeCircle(newRelativeCircle, circlePadding)) {
      newRelativeCircle.translateIntoEnclosingCircleOfRadius(this.absoluteReferenceCircle.r, circlePadding);
    }
    this.relativePosition.changeTo(newRelativeCircle);
    this.absoluteCircle.update(this.relativePosition, this.absoluteReferenceCircle);
  }
};

module.exports = {NodeCircle, ZeroCircle, Circle};