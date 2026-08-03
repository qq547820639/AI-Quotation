"""认证路由：login / logout / me"""
import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Token
from ..schemas import LoginParams, LoginResult, UserSchema, SuccessResult
from ..auth import get_current_user
from ..serializers import user_to_schema

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResult)
def login(body: LoginParams, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == body.userId).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    token = f"token-{user.id}-{secrets.token_hex(4)}"
    db.add(Token(token=token, user_id=user.id))
    db.commit()
    return LoginResult(user=user_to_schema(user), token=token)


@router.post("/logout", response_model=SuccessResult)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 删除当前用户所有 token（简化处理）
    db.query(Token).filter(Token.user_id == user.id).delete()
    db.commit()
    return SuccessResult(success=True)


@router.get("/me", response_model=UserSchema)
def me(user: User = Depends(get_current_user)):
    return user_to_schema(user)
