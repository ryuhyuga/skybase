# Skybase Tools: gắn nhãn, kiểm tra và xuất model .glb cho engine Skybase (Three.js).
# Bảng nằm ở khung 3D -> phím N -> tab "Skybase".
import bpy

from . import checks, export, prefabs, props, tags, toon, ui

_modules = (checks, export, prefabs, tags, toon, ui)


def register():
    props.register()
    for m in _modules:
        for c in m.classes:
            bpy.utils.register_class(c)


def unregister():
    for m in reversed(_modules):
        for c in reversed(m.classes):
            bpy.utils.unregister_class(c)
    props.unregister()
