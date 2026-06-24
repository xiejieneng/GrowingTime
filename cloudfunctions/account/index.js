const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const USERS = "users";

exports.main = async (event) => {
  const context = cloud.getWXContext();
  const openid = context.OPENID;
  if (!openid) {
    return {
      ok: false,
      message: "无法获取微信身份"
    };
  }

  const profile = event.profile || {};
  const existing = await db.collection(USERS).where({ openid }).limit(1).get();
  const now = db.serverDate();
  let user;
  let isNewUser = false;

  if (existing.data.length) {
    const record = existing.data[0];
    const patch = {
      nickName: profile.nickName || record.nickName || "微信用户",
      avatarUrl: profile.avatarUrl || record.avatarUrl || "",
      babyName: profile.babyName || record.babyName || "宝宝",
      lastLoginAt: now
    };
    await db.collection(USERS).doc(record._id).update({ data: patch });
    user = {
      id: record._id,
      babyId: record.babyId || `baby_${record._id}`,
      nickName: patch.nickName,
      avatarUrl: patch.avatarUrl,
      babyName: patch.babyName
    };
  } else {
    isNewUser = true;
    const data = {
      openid,
      nickName: profile.nickName || "微信用户",
      avatarUrl: profile.avatarUrl || "",
      babyName: profile.babyName || "宝宝",
      createdAt: now,
      lastLoginAt: now
    };
    const created = await db.collection(USERS).add({ data });
    user = {
      id: created._id,
      babyId: `baby_${created._id}`,
      nickName: data.nickName,
      avatarUrl: data.avatarUrl,
      babyName: data.babyName
    };
    await db.collection(USERS).doc(created._id).update({
      data: {
        babyId: user.babyId
      }
    });
  }

  return {
    ok: true,
    isNewUser,
    user
  };
};
