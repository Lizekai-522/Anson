<script setup>
// 家人页：给长辈页准备「家人电话」。
// 称呼是「长辈该怎么叫他」，不是「子女该怎么叫他」—— 子女写「爸爸」，长辈看到会以为是自己。
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { store, toast, uid, upsertFamily, removeFamily, upsertFamilyGroup, removeFamilyGroup, isLegacyFamilyTitle } from '../core/store.js'
import { rules } from '../core/accounts.js'
import { enterList } from '../core/motion.js'

defineProps({ params: { type: Object, default: () => ({}) } })

const listRef = ref(null)
onMounted(() => enterList(listRef.value ? listRef.value.children : null, 'list:family'))

// 从长辈视角的常用称呼（可自由输入，这只是建议）
const TITLE_SUGGESTS = ['老伴', '儿子', '女儿', '儿媳', '女婿', '孙子', '孙女', '外孙', '外孙女', '兄弟', '姐妹', '亲戚', '邻居', '社区医生']
const isLegacyTitle = (v) => isLegacyFamilyTitle(v)

const showForm = ref(false)
const editing = ref(null) // null = 新增；否则为正在编辑的家人
const form = reactive({ name: '', relation: '', phone: '', im: '', note: '', callsMe: '' })
const phoneErr = ref('')
const formErr = ref('')

function openAdd() {
  editing.value = null
  form.name = ''
  form.relation = ''
  form.phone = ''
  form.im = ''
  form.note = ''
  form.callsMe = ''
  phoneErr.value = ''
  formErr.value = ''
  showForm.value = true
}
function openEdit(member) {
  editing.value = member
  form.name = member.name || ''
  form.relation = member.relation || ''
  form.phone = member.phone || ''
  form.im = member.im || ''
  form.note = member.note || ''
  form.callsMe = member.callsMe || ''
  phoneErr.value = ''
  formErr.value = ''
  showForm.value = true
}
function closeForm() {
  showForm.value = false
  editing.value = null
}
function blurPhone() {
  phoneErr.value = rules.phone(form.phone.trim())
}
function saveFamily() {
  const name = form.name.trim()
  const phone = form.phone.trim()
  let err = ''
  if (!name) err = '请填写姓名'
  if (!err) err = rules.phone(phone)
  formErr.value = err
  if (err) return
  upsertFamily({
    id: editing.value ? editing.value.id : uid('fam'),
    name,
    relation: form.relation.trim(),
    // 「他对我的称呼」：只出现在长辈页家人卡片上（如「他叫你：妈」）
    callsMe: form.callsMe.trim(),
    phone,
    im: form.im.trim(),
    note: form.note.trim(),
  })
  toast(editing.value ? '家人信息已保存' : '家人已添加', 'ok')
  closeForm()
}

// ---- 家人分组：一个家人可以同时属于多个组，分享时按组一键带上 ----
const groups = computed(() => store.data.familyGroups || [])
const memberName = (id) => {
  const m = store.data.family.find((x) => x.id === id)
  return m ? m.name : ''
}
// 这个家人属于哪些组（家人卡片上的只读标签）
function groupsOf(familyId) {
  return groups.value.filter((g) => (g.memberIds || []).includes(familyId))
}
const groupForm = reactive({ open: false, editingId: '', name: '', memberIds: [] })
function openGroupAdd() {
  groupForm.open = true
  groupForm.editingId = ''
  groupForm.name = ''
  groupForm.memberIds = []
}
function openGroupEdit(g) {
  groupForm.open = true
  groupForm.editingId = g.id
  groupForm.name = g.name || ''
  groupForm.memberIds = [...(g.memberIds || [])]
}
function closeGroupForm() {
  groupForm.open = false
  groupForm.editingId = ''
}
function toggleGroupMember(id) {
  const i = groupForm.memberIds.indexOf(id)
  if (i >= 0) groupForm.memberIds.splice(i, 1)
  else groupForm.memberIds.push(id)
}
function saveGroup() {
  const name = groupForm.name.trim()
  if (!name) { toast('给分组起个名字', 'warn'); return }
  upsertFamilyGroup({ id: groupForm.editingId || uid('grp'), name, memberIds: groupForm.memberIds })
  toast(groupForm.editingId ? '分组已保存' : '分组已建立', 'ok')
  closeGroupForm()
}
function removeGroupClick(g) {
  if (!askConfirm('grp:' + g.id)) return
  removeFamilyGroup(g.id)
  toast('分组已删除', 'info')
}

// 删除家人（两步确认）
const confirmKey = ref('')
let confirmTimer = null
function askConfirm(key) {
  if (confirmKey.value === key) {
    confirmKey.value = ''
    clearTimeout(confirmTimer)
    return true
  }
  confirmKey.value = key
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmKey.value = '' }, 3000)
  return false
}
function removeFamilyClick(member) {
  if (!askConfirm('fam:' + member.id)) return
  removeFamily(member.id)
  toast('家人已删除', 'info')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">家人 · {{ store.data.family.length }} 位</span>
        <h1 class="page-title">长辈该找谁，你来定</h1>
        <p class="page-sub">这些电话会出现在长辈页的「家人电话」页上，长辈点一下就能打。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openAdd">+ 添加家人</button>
      </div>
    </header>

    <form v-if="showForm" class="paper-card fam-form" @submit.prevent="saveFamily">
      <h2 class="form-title">{{ editing ? '编辑家人' : '添加家人' }}</h2>
      <div class="form-grid">
        <div class="form-field">
          <label for="fam-name">姓名</label>
          <input id="fam-name" v-model="form.name" type="text" autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="fam-relation">称呼（长辈看到的就是这个）</label>
          <input
            id="fam-relation"
            v-model="form.relation"
            type="text"
            list="fam-relation-options"
            autocomplete="off"
            placeholder="如：儿子、老伴、社区医生"
          />
          <datalist id="fam-relation-options">
            <option v-for="r in TITLE_SUGGESTS" :key="r" :value="r"></option>
          </datalist>
          <small class="form-hint">写长辈叫得顺口的，别写「爸爸」—— 长辈看到会以为是自己</small>
        </div>
        <div class="form-field">
          <label for="fam-callsme">他对我的称呼（选填）</label>
          <input
            id="fam-callsme"
            v-model="form.callsMe"
            type="text"
            autocomplete="off"
            placeholder="如：妈、爸、奶奶"
          />
          <small class="form-hint">长辈端会显示「他叫你：妈」，让长辈确认这是谁</small>
        </div>
        <div class="form-field">
          <label for="fam-phone">手机号</label>
          <input id="fam-phone" v-model="form.phone" type="tel" autocomplete="off" @blur="blurPhone" />
          <p v-if="phoneErr" class="field-err" role="alert">{{ phoneErr }}</p>
        </div>
        <div class="form-field">
          <label for="fam-im">微信号 / QQ 号（选填）</label>
          <input id="fam-im" v-model="form.im" type="text" autocomplete="off" placeholder="留空就用手机号搜微信" />
        </div>
        <div class="form-field form-field-wide">
          <label for="fam-note">备注（选填）</label>
          <textarea
            id="fam-note"
            v-model="form.note"
            rows="3"
            placeholder="过敏、用药、住址等；这段字会原样显示在长辈页上"
          ></textarea>
        </div>
      </div>
      <p v-if="formErr" class="form-err" role="alert">{{ formErr }}</p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">保存</button>
        <button type="button" class="btn btn-ghost" @click="closeForm">取消</button>
      </div>
    </form>

    <ul v-if="store.data.family.length" class="fam-list" ref="listRef">
      <li v-for="m in store.data.family" :key="m.id" class="paper-card fam-card">
        <div class="fam-main">
          <div class="fam-top">
            <h2 class="fam-name">{{ m.name }}</h2>
            <span v-if="m.relation && !isLegacyTitle(m.relation)" class="tag tag-brand">{{ m.relation }}</span>
            <span v-else-if="isLegacyTitle(m.relation)" class="tag tag-warn">旧称呼：{{ m.relation }}</span>
            <!-- 他对长辈的称呼：长辈端家人卡片上会显示 -->
            <span v-if="m.callsMe" class="tag">他叫你：{{ m.callsMe }}</span>
            <!-- 只读分组标签：方便核对这个人被分进了哪几组 -->
            <span v-for="g in groupsOf(m.id)" :key="g.id" class="tag tag-group">{{ g.name }}</span>
          </div>
          <p class="fam-phone">{{ m.phone }}<span v-if="m.im" class="fam-im">· 微信/QQ {{ m.im }}</span></p>
          <p v-if="m.note" class="fam-note">{{ m.note }}</p>
          <p v-if="isLegacyTitle(m.relation)" class="fam-fix">
            这是按你自己叫的（长辈页不会显示）。建议点「编辑」改成长辈叫得顺口的，比如「儿子」「老伴」。
          </p>
        </div>
        <div class="fam-actions">
          <button class="btn btn-ghost btn-sm" @click="openEdit(m)">编辑</button>
          <button
            class="btn btn-danger btn-sm"
            :class="{ arming: confirmKey === 'fam:' + m.id }"
            @click="removeFamilyClick(m)"
          >{{ confirmKey === 'fam:' + m.id ? '确认删除？' : '删除' }}</button>
        </div>
      </li>
    </ul>

    <section v-else class="empty">
      <p class="kicker">空</p>
      <h2 class="empty-title">还没添加家人</h2>
      <p class="empty-hint">加上家人的电话，分享出去的行程会带上「家人电话」卡，长辈点一下就能打。</p>
      <button class="btn btn-primary" @click="openAdd">添加家人</button>
    </section>

    <!-- 分组：一个家人可以同时属于多个组；分享时按组一键带上这一队人 -->
    <section class="paper-card block groups" aria-label="家人分组">
      <div class="groups-head">
        <h2 class="block-title">家人分组</h2>
        <button class="btn btn-ghost btn-sm" @click="openGroupAdd">+ 新建分组</button>
      </div>
      <p class="block-hint">把常一起出行的家人分个组，分享时一键把它们都带上。同一个人可以进多个组。</p>

      <form v-if="groupForm.open" class="group-form" @submit.prevent="saveGroup">
        <div class="form-field">
          <label for="grp-name">分组名</label>
          <input id="grp-name" v-model="groupForm.name" type="text" placeholder="如：爷爷奶奶、老家亲戚" autocomplete="off" />
        </div>
        <div v-if="store.data.family.length" class="group-members">
          <label v-for="m in store.data.family" :key="m.id" class="group-member">
            <input
              type="checkbox"
              :checked="groupForm.memberIds.includes(m.id)"
              @change="toggleGroupMember(m.id)"
            />
            <span>{{ m.name }}</span>
          </label>
        </div>
        <p v-else class="block-hint">先添加家人，才能往分组里放人。</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-sm">保存分组</button>
          <button type="button" class="btn btn-ghost btn-sm" @click="closeGroupForm">取消</button>
        </div>
      </form>

      <ul v-if="groups.length" class="group-list">
        <li v-for="g in groups" :key="g.id" class="group-row">
          <div class="group-info">
            <span class="group-name">{{ g.name }}</span>
            <span class="group-members-text">
              {{ (g.memberIds || []).map(memberName).filter(Boolean).join('、') || '还没有成员' }}
            </span>
          </div>
          <div class="group-actions">
            <button class="btn btn-ghost btn-sm" @click="openGroupEdit(g)">编辑</button>
            <button
              class="btn btn-danger btn-sm"
              :class="{ arming: confirmKey === 'grp:' + g.id }"
              @click="removeGroupClick(g)"
            >{{ confirmKey === 'grp:' + g.id ? '确认删除？' : '删除' }}</button>
          </div>
        </li>
      </ul>
      <p v-else class="block-hint">还没有分组。把常一起出行的家人分个组，分享时一键带上。</p>
    </section>
  </div>
</template>

<style scoped>
.fam-form { padding: 18px; margin-bottom: 16px; }
.form-title { margin: 0 0 12px; font-size: 18px; letter-spacing: 1px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.form-field label { display: block; font-size: 13px; color: var(--c-ink-1); margin-bottom: 4px; }
.form-field-wide { grid-column: 1 / -1; }
textarea { resize: vertical; font-size: 14px; }
.field-err { margin: 4px 0 0; font-size: 12px; color: var(--c-err); }
.form-err {
  margin: 12px 0 0;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--c-err);
  background: rgba(179, 38, 30, 0.05);
  border-left: 3px solid var(--c-err);
  border-radius: 0 var(--r-s) var(--r-s) 0;
}
.form-actions { margin-top: 14px; display: flex; gap: 8px; }

.fam-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fam-card { padding: 16px 18px; }
.fam-main { display: flex; flex-direction: column; gap: 2px; }
.fam-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fam-name { margin: 0; font-size: 20px; letter-spacing: 1px; }
.fam-phone { margin: 2px 0 0; font-size: 15px; color: var(--c-ink-1); }
.fam-im { margin-left: 8px; font-size: 13px; color: var(--c-ink-2); }
.fam-fix {
  margin: 8px 0 0;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--c-warn);
  background: rgba(154, 107, 8, 0.07);
  border-left: 3px solid var(--c-warn);
  border-radius: 0 var(--r-s) var(--r-s) 0;
}
.form-hint { display: block; margin-top: 4px; font-size: 12px; color: var(--c-ink-2); }
.fam-note {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--c-ink-2);
  white-space: pre-line;
}
.fam-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--c-line);
  display: flex;
  gap: 8px;
}

/* ---- 家人分组 ---- */
.groups { margin-top: 16px; }
.groups-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.tag-group { border-color: rgba(11, 107, 69, 0.35); color: var(--c-brand); }
.group-form {
  margin-top: 14px;
  padding: 14px;
  border: 1px dashed var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-bg-1);
}
.group-members { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.group-member {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-s);
  background: var(--c-card);
  font-size: 14px;
  cursor: pointer;
}
.group-member input { width: auto; accent-color: var(--c-brand); }
.group-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.group-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 0;
  border-bottom: 1px dashed var(--c-line);
}
.group-row:last-child { border-bottom: none; }
.group-info { min-width: 0; }
.group-name { display: block; font-size: 16px; font-weight: 700; }
.group-members-text { display: block; margin-top: 2px; font-size: 13px; color: var(--c-ink-2); }
.group-actions { display: flex; gap: 8px; }
</style>
